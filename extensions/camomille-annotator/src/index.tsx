import { id } from './id';
import * as cs3dTools from '@cornerstonejs/tools';
import { getEnabledElement, StackViewport, VolumeViewport } from '@cornerstonejs/core';


type MeasurementPoint =
  | { x: number; y: number; z?: number; worldCoord?: { x: number; y: number; z: number } }
  | [number, number, number];

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
    const { measurementService, viewportGridService } = servicesManager.services || {};

    if (!measurementService) {
      console.warn(
        '[camomille-annotator-link] measurementService not available; extension will be inert.'
      );
      return;
    }

    console.log(
      '[camomille-annotator-link] measurementService available. Keys:',
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

    // ---------------- Gestion des événements MeasurementService ----------------

    const handleMeasurementAdded = ({
      source,
      measurement
    }: {
      source: any;
      measurement: any;
    }) => {
      const annotation = cs3dTools.annotation.state.getAnnotation(measurement.uid);
      if (!annotation) return;

      const payload: MeasurementAddedOrUpdatedPayload = {
        type: 'ohif-meningioma-measurement-added',
        measurementUID: annotation.annotationUID,
        measurement: annotation,
      };

      console.log(
        '[camomille-annotator-link] measurement ADDED -> cs3dTools annotation :',
        payload
      );

      try {
        window.parent?.postMessage(payload, '*');
      } catch (err) {
        console.error(
          '[camomille-annotator-link] Failed to post measurement ADDED to parent:',
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
      const annotation = cs3dTools.annotation.state.getAnnotation(measurement.uid);
      if (!annotation) return;

      const payload: MeasurementAddedOrUpdatedPayload = {
        type: 'ohif-meningioma-measurement-updated',
        measurementUID: annotation.annotationUID,
        measurement: annotation,
      };

      console.log(
        '[camomille-annotator-link] measurement UPDATED -> payload :',
        payload
      );

      try {
        window.parent?.postMessage(payload, '*');
      } catch (err) {
        console.error(
          '[camomille-annotator-link] Failed to post measurement UPDATED to parent:',
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

      const payload: MeasurementRemovedPayload = {
        type: 'ohif-meningioma-measurement-removed',
        measurementUID,
      };

      console.log(
        '[camomille-annotator-link] measurement REMOVED -> payload :',
        payload
      );

      try {
        window.parent?.postMessage(payload, '*');
      } catch (err) {
        console.error(
          '[camomille-annotator-link] Failed to post measurement REMOVED to parent:',
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

    const processBootstrapNow = (msg: any) => {
      console.log(
          '[camomille-annotator-link] processBootstrapNow received:',
          msg
        );

      console.log('[camomille-annotator-link] Processing bootstrap annotations…');

      for (const core of msg) {
        try {
          cs3dTools.annotation.state.addAnnotation(core);
        } catch (err) {
          console.error(
            '[camomille-annotator-link] Failed to addAnnotation from rawAnnotation:',
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
                  console.log(`[camomille] Viewport ${vpId} ignoré (Type: volume3d)`);
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
              console.warn('[camomille] Aucun viewport aligné trouvé, utilisation du viewport actif.');
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
          '[camomille-annotator-link] Bootstrap measurements received:',
          data.measurements
        );

        // On tente immédiatement, sinon on met en attente
        processBootstrapNow(data.measurements);
        return;
      }
    };

    window.addEventListener('message', messageListener);

    window.__OHIF_MENINGIOMA_LINK__ = {
      ...(window.__OHIF_MENINGIOMA_LINK__ || {}),
      subscriptions,
      messageListener,
    };

    console.log(
      '[camomille-annotator-link] preRegistration completed (MeasurementService wired).'
    );
  },

  getPanelModule: () => null,
};
