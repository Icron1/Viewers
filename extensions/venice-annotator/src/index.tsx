import { id } from './id';
import * as cs3dTools from '@cornerstonejs/tools';
import { vec3 } from 'gl-matrix';
import { eventTarget } from '@cornerstonejs/core';

type MeasurementAddedOrUpdatedPayload = {
  type: 'ohif-measurement-added' | 'ohif-measurement-updated';
  measurementUID: string;
  measurement: any;
};

type MeasurementRemovedPayload = {
  type: 'ohif-measurement-removed';
  measurementUID: string;
};

type BootstrapMeasurementsMessage = {
  type: 'ohif-bootstrap-measurements';
  measurements: any[];
};

type JumpToMeasurementMessage = {
  type: 'ohif-jump-to-measurement';
  measurementUID: string;
  viewportId?: string | null;
};

type AnyIncomingMessage = JumpToMeasurementMessage | BootstrapMeasurementsMessage;

declare global {
  interface Window {
    __OHIF_VENICE_LINK__?: {
      subscriptions?: { unsubscribe: () => void }[];
      messageListener?: (event: MessageEvent) => void;
      cleanupModal?: () => void;
    };
  }
}

export default {
  id,

  async preRegistration({
    servicesManager,
  }: {
    servicesManager: any;
  }): Promise<void> {
    const url = window.location.href;
    const isVeniceMode = url.includes('/venice') || url.includes('mode=venice');

    if (!isVeniceMode) {
      console.log('[venice-annotator-link] Not in venice mode, skipping wiring.');
      return;
    }

    console.log('[venice-annotator-extension] Activated');

    const CIRCLEROI_TOOL_NAME = 'CircleROI';
    const { measurementService, viewportGridService, cornerstoneViewportService } =
      servicesManager.services || {};

    if (!measurementService) {
      console.warn(
        '[venice-annotator-extension] measurementService not available; extension will be inert.'
      );
      return;
    }

    const { EVENTS } = measurementService;
    const measurementUIDs = new Set<string>();

    // ---------------- Helpers généraux ----------------

    function isSameOrientation(vecA: number[], vecB: number[]) {
      const dot = vecA[0] * vecB[0] + vecA[1] * vecB[1] + vecA[2] * vecB[2];
      return Math.abs(dot) > 0.95;
    }

    function isCircleROIMeasurement(measurement: any): boolean {
      if (!measurement) return false;

      if (
        measurement.toolName === CIRCLEROI_TOOL_NAME ||
        measurement.toolType === CIRCLEROI_TOOL_NAME
      ) {
        return true;
      }

      const annUID = measurement.uid || measurement.annotationUID;
      if (!annUID) return false;

      const annotation = cs3dTools.annotation.state.getAnnotation(annUID);
      if (!annotation || !annotation.metadata) return false;

      return annotation.metadata.toolName === CIRCLEROI_TOOL_NAME;
    }

    function getWorldPointFromAnnotation(annotation: any): number[] | null {
      if (!annotation) return null;

      const pts: number[][] | undefined = annotation?.data?.handles?.points;
      if (Array.isArray(pts) && pts.length > 0 && Array.isArray(pts[0])) {
        return pts[0];
      }

      const fp = annotation?.metadata?.cameraFocalPoint;
      if (Array.isArray(fp) && fp.length === 3) return fp;

      return null;
    }

    function jumpToSliceBootstrapLike(viewport: any, worldPoint: number[]) {
      viewport.resetCamera?.();
      viewport.render?.();

      const cam = viewport.getCamera();
      const normal = vec3.normalize(vec3.create(), cam.viewPlaneNormal as any);

      const fp = cam.focalPoint as any;
      const pos = cam.position as any;

      const v = vec3.subtract(vec3.create(), worldPoint as any, fp);
      const distAlongNormal = vec3.dot(v, normal);

      const delta = vec3.scale(vec3.create(), normal, distAlongNormal);

      const newFocal = vec3.add(vec3.create(), fp, delta);
      const newPos = vec3.add(vec3.create(), pos, delta);

      viewport.setCamera({
        focalPoint: Array.from(newFocal),
        position: Array.from(newPos),
        viewPlaneNormal: cam.viewPlaneNormal,
        viewUp: cam.viewUp,
        parallelScale: cam.parallelScale,
      });

      viewport.render?.();
    }

    function postToParent(type: MeasurementAddedOrUpdatedPayload['type'], annotationUID: string) {
      const annotation = cs3dTools.annotation.state.getAnnotation(annotationUID);
      if (!annotation) return;

      const label = (annotation.data?.label ?? '').trim();
      if (!label) return;

      const payload: MeasurementAddedOrUpdatedPayload = {
        type,
        measurementUID: annotation.annotationUID,
        measurement: annotation,
      };

      try {
        window.parent?.postMessage(payload, '*');
      } catch (err) {
        console.error('[VENICE] Failed to post to parent:', err);
      }
    }

    function applyLabel(annotationUID: string, labelRaw: string): boolean {
      const label = (labelRaw ?? '').trim();
      if (!label) return false;

      const ann = cs3dTools.annotation.state.getAnnotation(annotationUID);
      if (!ann) return false;

      ann.data = ann.data || {};
      ann.data.label = label;

      try {
        (cs3dTools.annotation.state as any).updateAnnotation?.(ann);
      } catch {
        // no-op
      }

      return true;
    }

    // ---------------- Modal HTML minimal (dans l'iframe) ----------------

    // ---------------- Modal HTML minimal (dans l'iframe) ----------------

    const MODAL_ID = 'venice-label-modal-root';

    type RoiLabel =
      | 'N' | 'SLS' | 'STD' | 'STG' | 'SSD' | 'SSG' | 'VJD' | 'VJG' | 'SD' | 'VG';

    const LABEL_DISPLAY: Record<RoiLabel, string> = {
      N: 'Bruit (Noise)',
      SLS: 'Sinus longitudinal supérieur',
      STD: 'Sinus transverse droit',
      STG: 'Sinus transverse gauche',
      SSD: 'Sinus sigmoïde droit',
      SSG: 'Sinus sigmoïde gauche',
      VJD: 'Veine jugulaire interne droite',
      VJG: 'Veine jugulaire interne gauche',
      SD: 'Sinus droit',
      VG: 'Grande veine cérébrale (de Galien)',
    };

    function ensureModalRoot(): HTMLDivElement {
      let root = document.getElementById(MODAL_ID) as HTMLDivElement | null;
      if (root) return root;

      root = document.createElement('div');
      root.id = MODAL_ID;
      document.body.appendChild(root);
      return root;
    }

    function closeModal() {
      const root = document.getElementById(MODAL_ID);
      if (root) root.remove();
      document.removeEventListener('keydown', onKeyDown, true);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        closeModal();
      }
    }

    function openLabelModal(annotationUID: string) {
      // évite double modals
      closeModal();

      const ann = cs3dTools.annotation.state.getAnnotation(annotationUID);
      if (!ann) return;

      const current = (ann.data?.label ?? '').trim();
      if (current) return; // déjà nommé

      const root = ensureModalRoot();

      // overlay container
      root.className = 'venice-modal-overlay';
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-modal', 'true');
      root.setAttribute('aria-label', 'Nommer la ROI');

      // inject style (scopé à l’iframe)
      const style = document.createElement('style');
      style.textContent = `
    :root {
      /* fallback tokens (copie Annotator) */
      --venice-bg-app: #0f111a;
      --venice-bg-panel: #161b27;
      --venice-bg-surface: #1e2536;
      --venice-bg-input: #121620;
      --venice-border-subtle: #2d374e;
      --venice-text-primary: #e2e8f0;
      --venice-text-secondary: #94a3b8;
      --venice-text-muted: #64748b;
      --venice-primary: #3b82f6;
      --venice-shadow-card: 0 22px 70px rgba(0,0,0,.65);
      --venice-radius-lg: 0.75rem;
      --venice-radius-md: 0.5rem;
      --venice-font: system-ui, -apple-system, Segoe UI, Roboto, Arial;
    }

    .venice-modal-overlay {
      position: fixed;
      inset: 0;
      z-index: 999999;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.65);
      padding: 16px;
    }

    .venice-modal {
      width: 560px;
      max-width: 94vw;
      background: var(--venice-bg-panel);
      color: var(--venice-text-primary);
      border: 1px solid var(--venice-border-subtle);
      border-radius: var(--venice-radius-lg);
      box-shadow: var(--venice-shadow-card);
      font-family: var(--venice-font);
      overflow: hidden;
      animation: veniceFadeScale .18s cubic-bezier(0.16, 1, 0.3, 1);
    }

    @keyframes veniceFadeScale {
      from { opacity: 0; transform: translateY(4px) scale(.98); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }

    .venice-modal-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 16px 10px;
      border-bottom: 1px solid var(--venice-border-subtle);
      background: rgba(0,0,0,0.10);
    }

    .venice-title {
      margin: 0;
      font-size: 14px;
      font-weight: 800;
      letter-spacing: .02em;
    }

    .venice-hint {
      margin-top: 4px;
      font-size: 12px;
      color: var(--venice-text-muted);
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    }

    .venice-close {
      border: 1px solid var(--venice-border-subtle);
      background: var(--venice-bg-surface);
      color: var(--venice-text-secondary);
      width: 34px;
      height: 34px;
      border-radius: 8px;
      cursor: pointer;
      transition: transform .05s ease, border-color .15s ease, background .15s ease, color .15s ease;
      flex: 0 0 auto;
    }
    .venice-close:hover {
      border-color: var(--venice-primary);
      color: var(--venice-primary);
      background: rgba(59,130,246,0.10);
      transform: translateY(-1px);
    }
    .venice-close:active { transform: translateY(0); }

    .venice-body { padding: 14px 16px 16px; }

    .venice-subtitle {
      font-size: 12px;
      color: var(--venice-text-secondary);
      margin: 0 0 10px;
      line-height: 1.35;
    }

    .venice-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    @media (max-width: 520px) {
      .venice-grid { grid-template-columns: 1fr; }
    }

    .venice-chip {
      text-align: left;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 12px;
      border-radius: var(--venice-radius-md);
      border: 1px solid var(--venice-border-subtle);
      background: var(--venice-bg-surface);
      color: var(--venice-text-primary);
      cursor: pointer;
      transition: transform .06s ease, border-color .15s ease, background .15s ease, box-shadow .15s ease;
      user-select: none;
    }

    .venice-chip:hover {
      border-color: var(--venice-primary);
      background: rgba(59,130,246,0.10);
      box-shadow: 0 0 0 1px rgba(59,130,246,0.35);
      transform: translateY(-1px);
    }
    .venice-chip:active { transform: translateY(0); }

    .venice-code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      font-weight: 900;
      letter-spacing: .06em;
      font-size: 12px;
      color: #93c5fd;
      background: rgba(59,130,246,0.12);
      border: 1px solid rgba(59,130,246,0.30);
      padding: 4px 8px;
      border-radius: 999px;
      flex: 0 0 auto;
    }

    .venice-label {
      font-size: 13px;
      color: var(--venice-text-primary);
      line-height: 1.25;
    }

    .venice-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      padding: 12px 16px 16px;
      border-top: 1px solid var(--venice-border-subtle);
      background: rgba(0,0,0,0.10);
    }

    .venice-btn {
      border-radius: 10px;
      padding: 8px 12px;
      cursor: pointer;
      border: 1px solid var(--venice-border-subtle);
      background: transparent;
      color: var(--venice-text-secondary);
      font-family: var(--venice-font);
      transition: background .15s ease, border-color .15s ease, color .15s ease;
    }
    .venice-btn:hover {
      background: var(--venice-bg-surface);
      border-color: var(--venice-primary);
      color: var(--venice-primary);
    }
  `;
      root.appendChild(style);

      // box
      const box = document.createElement('div');
      box.className = 'venice-modal';

      const header = document.createElement('div');
      header.className = 'venice-modal-header';

      const headerLeft = document.createElement('div');

      const title = document.createElement('div');
      title.className = 'venice-title';
      title.textContent = 'Nommer la ROI';

      const hint = document.createElement('div');
      hint.className = 'venice-hint';
      hint.textContent = `UID: ${annotationUID.slice(0, 8)}…`;

      headerLeft.appendChild(title);
      headerLeft.appendChild(hint);

      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'venice-close';
      x.textContent = '✕';
      x.onclick = () => closeModal();

      header.appendChild(headerLeft);
      header.appendChild(x);

      const body = document.createElement('div');
      body.className = 'venice-body';

      const subtitle = document.createElement('div');
      subtitle.className = 'venice-subtitle';
      subtitle.textContent = 'Choisissez la structure veineuse :';

      const grid = document.createElement('div');
      grid.className = 'venice-grid';

      const commit = (label: string) => {
        const v = label.trim();
        if (!v) return;

        if (applyLabel(annotationUID, v)) {
          postToParent('ohif-measurement-added', annotationUID);
          closeModal();
        }
      };

      // ordre affichage (tu peux ajuster)
      const order: RoiLabel[] = ['SLS', 'STD', 'STG', 'SSD', 'SSG', 'VJD', 'VJG', 'SD', 'VG', 'N'];

      for (const key of order) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'venice-chip';
        b.setAttribute('data-label', key);

        const code = document.createElement('span');
        code.className = 'venice-code';
        code.textContent = key;

        const label = document.createElement('span');
        label.className = 'venice-label';
        label.textContent = LABEL_DISPLAY[key];

        b.appendChild(code);
        b.appendChild(label);

        b.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          commit(key);
        };

        grid.appendChild(b);
      }

      const actions = document.createElement('div');
      actions.className = 'venice-actions';

      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'venice-btn';
      cancel.textContent = 'Annuler';
      cancel.onclick = () => closeModal();

      actions.appendChild(cancel);

      body.appendChild(subtitle);
      body.appendChild(grid);

      box.appendChild(header);
      box.appendChild(body);
      box.appendChild(actions);
      root.appendChild(box);

      // click outside => cancel
      root.onclick = (e) => {
        if (e.target === root) closeModal();
      };

      document.addEventListener('keydown', onKeyDown, true);

      // focus "close" (évite focus dans le viewer derrière)
      setTimeout(() => x.focus(), 0);
    }

    // cleanup (HMR)
    if (window.__OHIF_VENICE_LINK__?.cleanupModal) {
      window.__OHIF_VENICE_LINK__.cleanupModal();
    }


    // ---------------- Cornerstone event: ANNOTATION_COMPLETED ----------------

    const onAnnotationCompleted = (evt: any) => {
      const ann = evt?.detail?.annotation;
      if (!ann) return;
      if (ann?.metadata?.toolName !== CIRCLEROI_TOOL_NAME) return;

      const uid = ann.annotationUID;
      // n’ouvre que si label vide
      const label = (ann.data?.label ?? '').trim();
      if (!label) openLabelModal(uid);
    };

    eventTarget.addEventListener(cs3dTools.Enums.Events.ANNOTATION_COMPLETED, onAnnotationCompleted);

    // ---------------- MeasurementService wiring ----------------

    const handleMeasurementAdded = ({ measurement }: { source: any; measurement: any }) => {
      if (!isCircleROIMeasurement(measurement)) return;

      console.log('[VENICE] [ADDED] uid=', measurement.uid);

      const annotation = cs3dTools.annotation.state.getAnnotation(measurement.uid);
      if (!annotation) return;

      measurementUIDs.add(annotation.annotationUID);

      // si label déjà présent (cas rare), on notifie direct
      const label = (annotation.data?.label ?? '').trim();
      if (label) postToParent('ohif-measurement-added', annotation.annotationUID);
    };

    const handleMeasurementUpdated = ({ measurement }: { source: any; measurement: any }) => {
      if (!isCircleROIMeasurement(measurement)) return;

      const annotation = cs3dTools.annotation.state.getAnnotation(measurement.uid);
      if (!annotation) return;

      const label = (annotation.data?.label ?? '').trim();
      console.log(
        '[VENICE] [UPDATED]',
        'measurement.uid=',
        measurement.uid,
        'annotation.annotationUID=',
        annotation.annotationUID,
        'label=',
        annotation.data?.label
      );

      if (!label) return;

      // si le label change après coup, on envoie updated
      postToParent('ohif-measurement-updated', annotation.annotationUID);
    };

    const handleMeasurementRemoved = ({ measurement }: { source: any; measurement: any }) => {
      const measurementUID =
        typeof measurement === 'string'
          ? measurement
          : measurement?.uid || measurement?.measurementUID || measurement?.annotationUID;

      if (!measurementUID) return;

      if (!measurementUIDs.has(measurementUID)) return;

      measurementUIDs.delete(measurementUID);

      const payload: MeasurementRemovedPayload = {
        type: 'ohif-measurement-removed',
        measurementUID,
      };

      try {
        window.parent?.postMessage(payload, '*');
      } catch (err) {
        console.error('[VENICE] Failed to post measurement REMOVED to parent:', err);
      }
    };

    const subscriptions = [
      measurementService.subscribe(EVENTS.MEASUREMENT_ADDED, handleMeasurementAdded),
      measurementService.subscribe(EVENTS.MEASUREMENT_UPDATED, handleMeasurementUpdated),
      measurementService.subscribe(EVENTS.MEASUREMENT_REMOVED, handleMeasurementRemoved),
    ];

    // ---------------- Bootstrap ----------------

    function waitForViewportsReady(
      viewportGridService: any,
      maxWaitMs = 8000,
      intervalMs = 200
    ): Promise<void> {
      return new Promise(resolve => {
        const start = Date.now();

        const check = () => {
          const impl = (viewportGridService as any)?.serviceImplementation;

          if (!impl || typeof impl._getState !== 'function') {
            if (Date.now() - start >= maxWaitMs) {
              console.warn(
                '[venice-annotator-extension] waitForViewportsReady => serviceImplementation not ready, giving up'
              );
              resolve();
              return;
            }
            setTimeout(check, intervalMs);
            return;
          }

          const { viewports } = viewportGridService.getState();

          const ready =
            viewports instanceof Map &&
            Array.from(viewports.values()).some(
              (vpState: any) =>
                Array.isArray(vpState.displaySetInstanceUIDs) &&
                vpState.displaySetInstanceUIDs.length > 0
            );

          if (ready) return resolve();

          if (Date.now() - start >= maxWaitMs) {
            console.warn(
              '[venice-annotator-extension] waitForViewportsReady => TIMEOUT, continue anyway'
            );
            return resolve();
          }

          setTimeout(check, intervalMs);
        };

        check();
      });
    }

    function safeAddAnnotation(core: any) {
      const uid = core?.annotationUID;
      if (!uid) return;

      const existing = cs3dTools.annotation.state.getAnnotation(uid);
      if (existing) {
        console.warn('[bootstrap] UID already exists, skipping', uid);
        return;
      }

      const cloned = structuredClone(core);
      cs3dTools.annotation.state.addAnnotation(cloned);
      measurementUIDs.add(cloned.annotationUID);
    }

    const processBootstrapNow = (msg: any[]) => {
      if (!Array.isArray(msg) || !msg.length) return;

      for (const core of msg) {
        try {
          if (!core) continue;
          core.invalidated = false;
          core.isPreview = false;
          safeAddAnnotation(core);
        } catch (err) {
          console.error(
            '[venice-annotator-extension] Failed to bootstrap annotation from core:',
            core,
            err
          );
        }
      }
    };

    // ---------------- Listener parent → OHIF ----------------

    const messageListener = (event: MessageEvent) => {
      const data = event.data as AnyIncomingMessage;
      if (!data) return;

      if (data.type === 'ohif-jump-to-measurement') {
        const { measurementUID } = data;

        const annotation = cs3dTools.annotation.state.getAnnotation(measurementUID);
        if (!annotation) return;

        const annotationNormal = annotation?.metadata?.viewPlaneNormal;
        const annotationFoR = annotation?.metadata?.FrameOfReferenceUID;

        const { viewports } = viewportGridService.getState();
        let targetViewport: any = null;

        if (data.viewportId) {
          const vp = cornerstoneViewportService?.getCornerstoneViewport(data.viewportId);
          if (vp) targetViewport = vp;
        }

        if (!targetViewport) {
          for (const [vpId, vpState] of viewports.entries()) {
            if (!vpState.displaySetInstanceUIDs) continue;
            if (vpState.viewportOptions?.viewportType === 'volume3d') continue;

            const csViewport = cornerstoneViewportService?.getCornerstoneViewport(vpId);
            if (!csViewport) continue;

            if (annotationFoR && csViewport.getFrameOfReferenceUID?.() !== annotationFoR) continue;

            const cam = csViewport.getCamera();
            if (annotationNormal && cam?.viewPlaneNormal) {
              if (isSameOrientation(annotationNormal, cam.viewPlaneNormal)) {
                targetViewport = csViewport;
                break;
              }
            }
          }
        }

        if (!targetViewport) {
          const activeId = viewportGridService.getActiveViewportId();
          targetViewport = cornerstoneViewportService?.getCornerstoneViewport(activeId);
        }

        if (!targetViewport) return;

        const worldPoint = getWorldPointFromAnnotation(annotation);
        if (!worldPoint) return;

        jumpToSliceBootstrapLike(targetViewport, worldPoint);
        return;
      }

      if (data.type === 'ohif-bootstrap-measurements') {
        waitForViewportsReady(viewportGridService, 8000, 200).then(() => {
          processBootstrapNow(data.measurements);
        });
        return;
      }
    };

    if (window.__OHIF_VENICE_LINK__?.messageListener) {
      window.removeEventListener('message', window.__OHIF_VENICE_LINK__.messageListener);
    }
    window.addEventListener('message', messageListener);

    // Ready signals
    try {
      window.parent?.postMessage({ type: 'ohif-ready' }, '*');
    } catch { }

    window.__OHIF_VENICE_LINK__ = {
      ...(window.__OHIF_VENICE_LINK__ || {}),
      subscriptions,
      messageListener,
      cleanupModal: closeModal,
    };

    console.log('[venice-annotator-extension] preRegistration completed.');
  },

  getPanelModule: () => null,
};
