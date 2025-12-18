import { id } from './id';
import * as cs3dTools from '@cornerstonejs/tools';
import { vec3 } from 'gl-matrix';

type MeasurementAddedOrUpdatedPayload = {
  type:
  | 'ohif-meningioma-measurement-added'
  | 'ohif-meningioma-measurement-updated';
  measurementUID: string;
  measurement: any;
};

type MeasurementRemovedPayload = {
  type: 'ohif-meningioma-measurement-removed';
  measurementUID: string;
};

type BootstrapMeningiomaMessage = {
  type: 'ohif-meningioma-bootstrap-measurements';
  measurements: any[];
};

type JumpToMeningiomaMessage = {
  type: 'ohif-meningioma-jump-to-measurement';
  measurementUID: string;
  viewportId?: string | null;
};

type AnyIncomingMessage = JumpToMeningiomaMessage | BootstrapMeningiomaMessage;

declare global {
  interface Window {
    __OHIF_MENINGIOMA_LINK__?: {
      subscriptions?: { unsubscribe: () => void }[];
      messageListener?: (event: MessageEvent) => void;
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

    const isCamomilleMode =
      url.includes('/camomille') || url.includes('mode=camomille');

    if (!isCamomilleMode) {
      console.log(
        '[camomille-annotator-link] Not in camomille mode, skipping wiring.'
      );
      return;
    }

    console.log('[camomille-annotator-extension] Activated');

    const ARROW_TOOL_NAME = 'ArrowAnnotate';
    const {
      measurementService,
      viewportGridService,
      cornerstoneViewportService,
    } = servicesManager.services || {};

    if (!measurementService) {
      console.warn(
        '[camomille-annotator-extension] measurementService not available; extension will be inert.'
      );
      return;
    }

    const { EVENTS } = measurementService;

    // ---------------- Helpers généraux ----------------

    function isSameOrientation(vecA: number[], vecB: number[]) {
      const dot = vecA[0] * vecB[0] + vecA[1] * vecB[1] + vecA[2] * vecB[2];
      return Math.abs(dot) > 0.95;
    }

    const arrowMeasurementUIDs = new Set<string>();

    function isArrowMeasurement(measurement: any): boolean {
      if (!measurement) return false;

      if (
        measurement.toolName === ARROW_TOOL_NAME ||
        measurement.toolType === ARROW_TOOL_NAME
      ) {
        return true;
      }

      const annUID = measurement.uid || measurement.annotationUID;
      if (!annUID) return false;

      const annotation = cs3dTools.annotation.state.getAnnotation(annUID);
      if (!annotation || !annotation.metadata) return false;

      const metaToolName =
        annotation.metadata.toolName || annotation.metadata.toolType;

      return metaToolName === ARROW_TOOL_NAME;
    }

    /**
     * Point monde "référence" pour aller sur la coupe.
     * On prend un handle (flèche), sinon fallback metadata.
     */
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

    /**
     * MPR only:
     * - resetCamera => vue "bootstrap-like" (pan/zoom neutres)
     * - puis translation uniquement selon le normal pour tomber sur la bonne coupe
     * - pas de recentrage dans le plan (donc pas de pan)
     */
    function jumpToSliceBootstrapLike(viewport: any, worldPoint: number[]) {
      // 1) Reset comme bootstrap
      viewport.resetCamera?.();
      viewport.render?.();

      // 2) Caméra après reset
      const cam = viewport.getCamera();
      const normal = vec3.normalize(vec3.create(), cam.viewPlaneNormal as any);

      const fp = cam.focalPoint as any;
      const pos = cam.position as any;

      // Projection du point monde sur l'axe normal
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
        // zoom "baseline" après resetCamera
        parallelScale: cam.parallelScale,
      });

      viewport.render?.();
    }

    // ---------------- Gestion des événements MeasurementService ----------------

    const handleMeasurementAdded = ({
      measurement,
    }: {
      source: any;
      measurement: any;
    }) => {
      if (!isArrowMeasurement(measurement)) return;

      const annotation = cs3dTools.annotation.state.getAnnotation(measurement.uid);
      if (!annotation) return;

      if (annotation.data?.label?.length === 0) return;

      arrowMeasurementUIDs.add(annotation.annotationUID);

      const payload: MeasurementAddedOrUpdatedPayload = {
        type: 'ohif-meningioma-measurement-added',
        measurementUID: annotation.annotationUID,
        measurement: annotation,
      };

      try {
        window.parent?.postMessage(payload, '*');
      } catch (err) {
        console.error(
          '[camomille-annotator-extension] Failed to post measurement ADDED to parent:',
          err
        );
      }
    };

    const handleMeasurementUpdated = ({
      measurement,
    }: {
      source: any;
      measurement: any;
    }) => {
      if (!isArrowMeasurement(measurement)) return;

      const annotation = cs3dTools.annotation.state.getAnnotation(measurement.uid);
      if (!annotation) return;

      if (annotation.data?.label?.length === 0) return;

      const payload: MeasurementAddedOrUpdatedPayload = {
        type: 'ohif-meningioma-measurement-updated',
        measurementUID: annotation.annotationUID,
        measurement: annotation,
      };

      try {
        window.parent?.postMessage(payload, '*');
      } catch (err) {
        console.error(
          '[camomille-annotator-extension] Failed to post measurement UPDATED to parent:',
          err
        );
      }
    };

    const handleMeasurementRemoved = ({
      measurement,
    }: {
      source: any;
      measurement: string;
    }) => {
      const measurementUID = measurement;
      if (!measurementUID) return;

      if (!arrowMeasurementUIDs.has(measurementUID)) return;

      arrowMeasurementUIDs.delete(measurementUID);

      const payload: MeasurementRemovedPayload = {
        type: 'ohif-meningioma-measurement-removed',
        measurementUID,
      };

      try {
        window.parent?.postMessage(payload, '*');
      } catch (err) {
        console.error(
          '[camomille-annotator-extension] Failed to post measurement REMOVED to parent:',
          err
        );
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
                '[camomille-annotator-extension] waitForViewportsReady => serviceImplementation not ready, giving up'
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

          if (ready) {
            resolve();
            return;
          }

          if (Date.now() - start >= maxWaitMs) {
            console.warn(
              '[camomille-annotator-extension] waitForViewportsReady => TIMEOUT, continue anyway'
            );
            resolve();
            return;
          }

          setTimeout(check, intervalMs);
        };

        check();
      });
    }

    const processBootstrapNow = (msg: any[]) => {
      if (!Array.isArray(msg) || !msg.length) return;

      for (const core of msg) {
        try {
          if (!core) continue;

          core.invalidated = false;
          core.isPreview = false;

          cs3dTools.annotation.state.addAnnotation(core);
          arrowMeasurementUIDs.add(core.annotationUID);
        } catch (err) {
          console.error(
            '[camomille-annotator-extension] Failed to bootstrap annotation from core:',
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

      // 1) Jump (MPR only)
      if (data.type === 'ohif-meningioma-jump-to-measurement') {
        const { measurementUID } = data;

        const annotation = cs3dTools.annotation.state.getAnnotation(measurementUID);
        if (!annotation) return;

        const annotationNormal = annotation?.metadata?.viewPlaneNormal;
        const annotationFoR = annotation?.metadata?.FrameOfReferenceUID;

        const { viewports } = viewportGridService.getState();

        let targetViewport: any = null;

        // Option viewportId si fourni (et valide)
        if (data.viewportId) {
          const vp = cornerstoneViewportService?.getCornerstoneViewport(data.viewportId);
          if (vp) targetViewport = vp;
        }

        // Sinon: choisir un viewport aligné (FoR + orientation)
        if (!targetViewport) {
          for (const [vpId, vpState] of viewports.entries()) {
            if (!vpState.displaySetInstanceUIDs) continue;

            // on ignore volume3d, on garde MPR
            if (vpState.viewportOptions?.viewportType === 'volume3d') continue;

            const csViewport =
              cornerstoneViewportService?.getCornerstoneViewport(vpId);
            if (!csViewport) continue;

            if (
              annotationFoR &&
              csViewport.getFrameOfReferenceUID?.() !== annotationFoR
            ) {
              continue;
            }

            const cam = csViewport.getCamera();
            if (annotationNormal && cam?.viewPlaneNormal) {
              if (isSameOrientation(annotationNormal, cam.viewPlaneNormal)) {
                targetViewport = csViewport;
                break;
              }
            }
          }
        }

        // Fallback: viewport actif
        if (!targetViewport) {
          const activeId = viewportGridService.getActiveViewportId();
          targetViewport =
            cornerstoneViewportService?.getCornerstoneViewport(activeId);
        }

        if (!targetViewport) return;

        const worldPoint = getWorldPointFromAnnotation(annotation);
        if (!worldPoint) return;

        // comportement demandé: reset "bootstrap-like" + aller sur la coupe
        jumpToSliceBootstrapLike(targetViewport, worldPoint);

        return;
      }

      // 2) Bootstrap
      if (data.type === 'ohif-meningioma-bootstrap-measurements') {
        waitForViewportsReady(viewportGridService, 8000, 200).then(() => {
          processBootstrapNow(data.measurements);
        });
        return;
      }
    };

    window.addEventListener('message', messageListener);

    try {
      window.parent?.postMessage({ type: 'ohif-meningioma-ready' }, '*');
    } catch (err) {
      console.error(
        '[camomille-annotator-extension] Failed to notify parent READY:',
        err
      );
    }

    window.__OHIF_MENINGIOMA_LINK__ = {
      ...(window.__OHIF_MENINGIOMA_LINK__ || {}),
      subscriptions,
      messageListener,
    };

    // --- Signal ready ---
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(
          { type: 'ohif-meningioma-extension-ready' },
          '*'
        );
      }
    } catch (err) {
      console.error('[camomille-annotator-extension] Failed to signal ready state:', err);
    }

    console.log(
      '[camomille-annotator-extension] preRegistration completed (MeasurementService wired).'
    );
  },

  getPanelModule: () => null,
};
