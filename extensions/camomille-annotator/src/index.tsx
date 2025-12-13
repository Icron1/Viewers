import { id } from './id';
import * as cs3dTools from '@cornerstonejs/tools';
import { getEnabledElement, StackViewport, VolumeViewport } from '@cornerstonejs/core';


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

type AnyIncomingMessage =
  | JumpToMeningiomaMessage
  | BootstrapMeningiomaMessage;

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
    const { measurementService, viewportGridService } = servicesManager.services || {};

    if (!measurementService) {
      console.warn(
        '[camomille-annotator-extension] measurementService not available; extension will be inert.'
      );
      return;
    }

    console.log(
      '[camomille-annotator-extension] measurementService available. Keys:',
      Object.keys(measurementService)
    );

    const { EVENTS, VALUE_TYPES } = measurementService;
    const bootstrapMetadataByUID = new Map<string, any>();
    const measurementViewportByUID = new Map<string, string>();

    // ---------------- Helpers généraux ----------------

    function isSameOrientation(vecA: number[], vecB: number[]) {
      // Produit scalaire simple
      const dot = vecA[0] * vecB[0] + vecA[1] * vecB[1] + vecA[2] * vecB[2];
      // On prend la valeur absolue car la caméra peut regarder "devant" ou "derrière" (flip), 
      // mais le plan de coupe reste le même.
      return Math.abs(dot) > 0.95;
    }

    const arrowMeasurementUIDs = new Set<string>();

    function isArrowMeasurement(measurement: any): boolean {
      if (!measurement) return false;

      // Suivant la version, ça peut être toolName ou toolType
      if (
        measurement.toolName === ARROW_TOOL_NAME ||
        measurement.toolType === ARROW_TOOL_NAME
      ) {
        return true;
      }

      // Si ce n'est pas sur l'objet measurement, on va chercher l'annotation Cornerstone
      const annUID = measurement.uid || measurement.annotationUID;
      if (!annUID) return false;

      const annotation = cs3dTools.annotation.state.getAnnotation(annUID);
      if (!annotation || !annotation.metadata) return false;

      const metaToolName =
        annotation.metadata.toolName || annotation.metadata.toolType;

      return metaToolName === ARROW_TOOL_NAME;
    }

    // ---------------- Gestion des événements MeasurementService ----------------

    const handleMeasurementAdded = ({
      source,
      measurement
    }: {
      source: any;
      measurement: any;
    }) => {
      if (!isArrowMeasurement(measurement)) {
        console.log('Non-Arrow measurement ADDED, ignoring:', measurement);
        return;
      }

      const annotation = cs3dTools.annotation.state.getAnnotation(measurement.uid);
      if (!annotation) return;

      if (annotation.data.label.length == 0) {
        // console.log("[camomille-annotator-extension] Annotation without label: ignoring");
        return
      }

      arrowMeasurementUIDs.add(annotation.annotationUID);

      const payload: MeasurementAddedOrUpdatedPayload = {
        type: 'ohif-meningioma-measurement-added',
        measurementUID: annotation.annotationUID,
        measurement: annotation,
      };

      console.log(
        '[camomille-annotator-extension] measurement ADDED -> cs3dTools annotation :',
        payload
      );

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
      source,
      measurement,
    }: {
      source: any;
      measurement: any;
    }) => {
      if (!isArrowMeasurement(measurement)) {
        console.log('Non-Arrow measurement UPDATED, ignoring:', measurement);
        return;
      }

      const annotation = cs3dTools.annotation.state.getAnnotation(measurement.uid);
      if (!annotation) return;

      if (annotation.data.label.length == 0) {
        // console.log("[camomille-annotator-extension] Annotation without label: ignoring");
        return
      }

      const payload: MeasurementAddedOrUpdatedPayload = {
        type: 'ohif-meningioma-measurement-updated',
        measurementUID: annotation.annotationUID,
        measurement: annotation,
      };

      console.log(
        '[camomille-annotator-extension] measurement UPDATED -> payload :',
        payload
      );

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
      source,
      measurement,
    }: {
      source: any;
      measurement: string;
    }) => {
      const measurementUID = measurement;
      if (!measurementUID) return;
      console.log('Removed measurement :', measurementUID);
      // Si on ne l'a jamais vu comme Arrow, on ignore
      if (!arrowMeasurementUIDs.has(measurementUID)) {
        console.log('Removed measurement is not Arrow, ignoring:', measurementUID);
        return;
      }

      // On nettoie notre Set
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
      measurementService.subscribe(
        EVENTS.MEASUREMENT_ADDED,
        handleMeasurementAdded
      ),
      measurementService.subscribe(
        EVENTS.MEASUREMENT_UPDATED,
        handleMeasurementUpdated
      ),
      measurementService.subscribe(
        EVENTS.MEASUREMENT_REMOVED,
        handleMeasurementRemoved
      ),
    ];

    // ---------------- Bootstrap ----------------

    let pendingBootstraps: BootstrapMeningiomaMessage[] = [];
    let bootstrapRetryTimer: number | null = null;
function waitForViewportsReady(
  viewportGridService,
  maxWaitMs = 8000,
  intervalMs = 200
): Promise<void> {
  return new Promise(resolve => {
    const start = Date.now();

    const check = () => {
      // 1) Vérifier que l'implémentation interne est prête
      const impl = (viewportGridService as any)?.serviceImplementation;

      if (!impl || typeof impl._getState !== 'function') {
        if (Date.now() - start >= maxWaitMs) {
          console.warn(
            '[camomille-annotator-extension] waitForViewportsReady => serviceImplementation not ready, giving up'
          );
          resolve();
          return;
        }

        console.log(
          '[camomille-annotator-extension] waitForViewportsReady: serviceImplementation not ready yet, retrying…'
        );
        setTimeout(check, intervalMs);
        return;
      }

      // 2) Maintenant seulement on appelle getState()
      const { viewports, activeViewportId, layout } =
        viewportGridService.getState();

      console.log(
        '[camomille-annotator-extension] waitForViewportsReady check:',
        {
          activeViewportId,
          layout,
          viewportsEntries:
            viewports && (viewports as any).entries
              ? Array.from((viewports as Map<any, any>).entries())
              : viewports,
        }
      );

      const ready =
        viewports instanceof Map &&
        Array.from(viewports.values()).some(
          vpState =>
            Array.isArray(vpState.displaySetInstanceUIDs) &&
            vpState.displaySetInstanceUIDs.length > 0
        );

      if (ready) {
        console.log(
          '[camomille-annotator-extension] waitForViewportsReady => READY'
        );
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
      console.log('[camomille-annotator-extension] Processing bootstrap annotations…');

      if (!Array.isArray(msg) || !msg.length) {
        console.log(
          '[camomille-annotator-extension] processBootstrapNow No measurements to bootstrap.'
        );
        return;
      }

      for (const core of msg) {
        try {
          if (!core) {
            console.warn(
              '[camomille-annotator-extension] annotation is null/undefined, skipping.'
            );
            continue;
          }

          core.invalidated = false;
          core.isPreview = false;


          cs3dTools.annotation.state.addAnnotation(core);
          arrowMeasurementUIDs.add(core.annotationUID);

        } catch (err) {
          console.error(
            '[camomille-annotator-extension] Failed to bootstrap annotation + measurement from core:',
            core,
            err
          );
        }
      }

      // Debug : voir ce que contient vraiment le MeasurementService après le bootstrap
      try {
        const measurements = measurementService.getMeasurements();
        console.log(
          '[camomille-annotator-extension] processBootstrapNow: measurementService.getMeasurements() =',
          measurements.map(m => ({ uid: m.uid, label: m.label, toolName: m.toolName }))
        );
      } catch (err) {
        console.warn(
          '[camomille-annotator-extension] Unable to introspect measurementService.getMeasurements():',
          err
        );
      }
    };


    // ---------------- Listener parent → OHIF ----------------

    const messageListener = (event: MessageEvent) => {
      console.log('[camomille-annotator-extension - IFRAME] message received:', event);
      console.log('[camomille-annotator-extension - IFRAME] event.origin =', event.origin);
      console.log('[camomille-annotator-extension - IFRAME] event.data =', event.data);
      
      const data = event.data as AnyIncomingMessage;
      if (!data) return;

      if (data.type === 'ohif-meningioma-jump-to-measurement') {
        const { measurementUID } = data;

        // 1. Récupérer l'annotation
        const annotation = cs3dTools.annotation.state.getAnnotation(measurementUID);
        if (!annotation) return;

        const { metadata } = annotation;
        const annotationNormal = metadata.viewPlaneNormal;
        const annotationFoR = metadata.FrameOfReferenceUID;

        // 2. Récupérer l'état de la grille (tous les viewports visibles)
        // Note: viewportGridService.getState() retourne la structure de la grille
        const { viewports } = viewportGridService.getState();

        let targetViewportId = null;
        let targetViewport = null;

        // 3. Chercher le viewport compatible (Même FoR + Même Orientation)
        for (const [vpId, vpState] of viewports.entries()) {
          // Ignorer les viewports vides
          if (!vpState.displaySetInstanceUIDs) continue;

          // Si c'est un viewport de type 3D/VR, on l'ignore pour ne garder que les MPR (Axial/Sag/Coro)
          if (vpState.viewportOptions?.viewportType === 'volume3d') {
            console.log(`[camomille-annotator-extension] Viewport ${vpId} ignoré (Type: volume3d)`);
            continue;
          }

          // Récupérer l'objet Cornerstone viewport réel
          const csViewport = servicesManager.services.cornerstoneViewportService.getCornerstoneViewport(vpId);
          if (!csViewport) continue;

          const camera = csViewport.getCamera();

          // A. Vérifier qu'on est dans le même repère spatial (FrameOfReference)
          // (Important si vous avez plusieurs séries chargées)
          if (csViewport.getFrameOfReferenceUID() !== annotationFoR) {
            continue;
          }

          // B. Vérifier l'orientation (Axial vs Sagittal vs Coronal)
          if (annotationNormal && camera.viewPlaneNormal) {
            if (isSameOrientation(annotationNormal, camera.viewPlaneNormal)) {
              targetViewportId = vpId;
              targetViewport = csViewport;
              break; // On a trouvé le bon plan, on arrête de chercher
            }
          }
        }

        // 4. Fallback : Si aucun plan ne correspond (ex: annotation Oblique), 
        // on se rabat sur le viewport actif, mais c'est risqué en MPR.
        if (!targetViewport) {
          console.warn('[camomille-annotator-extension] Aucun viewport aligné trouvé, utilisation du viewport actif.');
          const activeId = viewportGridService.getActiveViewportId();
          targetViewport = servicesManager.services.cornerstoneViewportService.getCornerstoneViewport(activeId);
        }

        // 5. Appliquer le saut (Jump)
        if (targetViewport) {
          const newCamera: any = {};

          if (metadata.cameraFocalPoint) {
            newCamera.focalPoint = metadata.cameraFocalPoint;
          } else if (annotation.data?.handles?.points) {
            newCamera.focalPoint = annotation.data.handles.points[0];
          }

          // OPTIONNEL : Si l'annotation n'est PAS alignée avec aucun viewport (ex: oblique),
          // alors et seulement alors on force l'orientation.
          // Mais dans votre cas (MPR standard), on évite cette ligne :
          // newCamera.viewPlaneNormal = metadata.viewPlaneNormal;

          targetViewport.setCamera(newCamera);
          targetViewport.render();
        }
      }

      // 2) Bootstrap des mesures
      if (data.type === 'ohif-meningioma-bootstrap-measurements') {
        console.log(
          '[camomille-annotator-extension] Bootstrap measurements received:',
          data.measurements
        );

        waitForViewportsReady(viewportGridService, 8000, 200).then(() => {
          console.log('[camomille-annotator-extension] Calling processBootstrapNow AFTER viewports are ready');
          processBootstrapNow(data.measurements);
        });

        return;
      }

    };

    console.log(
      '[camomille-annotator-extension] Installing message listener on window…'
    );
    window.addEventListener('message', messageListener);

    console.log('[camomille-annotator-extension] Message listener installed, notifying parent…');

    try {
      window.parent?.postMessage(
        { type: 'ohif-meningioma-ready' },
        '*'
      );
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

    console.log(
      '[camomille-annotator-extension] preRegistration completed (MeasurementService wired).'
    );

    // --- AJOUT : Signaler au parent que nous sommes prêts à recevoir des messages ---
    try {
      if (window.parent && window.parent !== window) {
        console.log('[camomille-annotator-extension] Post message ohif-meningioma-extension-ready');
        window.parent.postMessage({ type: 'ohif-meningioma-extension-ready' }, '*');
      }
    } catch (err) {
      console.error('[camomille-annotator-extension] Failed to signal ready state:', err);
    }
    // -------------------------------------------------------------------------------
  },

  getPanelModule: () => null,
};
