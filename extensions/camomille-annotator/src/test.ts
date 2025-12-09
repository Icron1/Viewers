// import { id } from './id';
// import { ArrowAnnotateTool } from '@cornerstonejs/tools';

// type MeasurementPoint =
//   | { x: number; y: number; z?: number; worldCoord?: { x: number; y: number; z: number } }
//   | [number, number, number];

// type MeasurementAddedOrUpdatedPayload = {
//   type:
//     | 'ohif-meningioma-measurement-added'
//     | 'ohif-meningioma-measurement-updated';
//   measurementUID: string;
//   measurement: any;
// };

// type MeasurementRemovedPayload = {
//   type: 'ohif-meningioma-measurement-removed';
//   measurementUID: string;
// };

// type BootstrapMeningiomaMessage = {
//   type: 'ohif-meningioma-bootstrap-measurements';
//   measurements: any[];
//   viewportId?: string | null;
// };

// type JumpToMeningiomaMessage = {
//   type: 'ohif-meningioma-jump-to-measurement';
//   measurementUID: string;
//   viewportId?: string | null;
// };

// type AnyIncomingMessage =
//   | JumpToMeningiomaMessage
//   | BootstrapMeningiomaMessage;

// declare global {
//   interface Window {
//     __OHIF_MENINGIOMA_LINK__?: {
//       subscriptions?: { unsubscribe: () => void }[];
//       messageListener?: (event: MessageEvent) => void;
//     };
//   }
// }

// export default {
//   id,

//   async preRegistration({
//     servicesManager,
//   }: {
//     servicesManager: any;
//   }): Promise<void> {
//     const { measurementService, viewportGridService } = servicesManager.services || {};

//     if (!measurementService) {
//       console.warn(
//         '[camomille-annotator-link] measurementService not available; extension will be inert.'
//       );
//       return;
//     }

//     console.log(
//       '[camomille-annotator-link] measurementService available. Keys:',
//       Object.keys(measurementService)
//     );

//     const { EVENTS, VALUE_TYPES } = measurementService;
//     const bootstrapMetadataByUID = new Map<string, any>();
//     const measurementViewportByUID = new Map<string, string>();

//     // ---------------- Helpers généraux ----------------

//     const buildCoreFromMeasurement = (measurement: any): any | null => {
//       console.log('[camomille-annotator-link] measurement : ', measurement);

//       if (!measurement) return null;

//       // 1) On récupère un identifiant unique
//       const measurementUID: string | undefined =
//         measurement.measurementUID ?? measurement.uid;

//       if (!measurementUID) {
//         console.warn(
//           '[camomille-annotator-link] buildCoreFromMeasurement: no uid/measurementUID on measurement',
//           measurement
//         );
//         return null;
//       }

//       // 2) On filtre uniquement les points
//       const isPointType =
//         measurement.type === VALUE_TYPES.POINT ||
//         (measurement.type === VALUE_TYPES.POLYLINE &&
//           Array.isArray(measurement.points) &&
//           measurement.points.length === 1);
//       if (!isPointType) return null;

//       // 3) On crée une version JSON
//       const core = JSON.parse(JSON.stringify(measurement));

//       console.log(
//           '[camomille-annotator-link] buildCoreFromMeasurement:core: ',
//           core
//       );

//       return core;
//     };

//     const normalizePoints = (points: any): [number, number, number][] => {
//       if (!points || !Array.isArray(points) || points.length === 0) {
//         return [];
//       }
//       return points.map((p: any) => {
//         // Format [x, y, z?]
//         if (Array.isArray(p)) {
//           const [x, y, z = 0] = p;
//           return [x, y, z];
//         }

//         const x = p.x ?? 0;
//         const y = p.y ?? 0;
//         const z = p.z ?? p.worldCoord?.z ?? 0;
//         return [x, y, z];
//       });
//     };

//     const getMeasurementStore = (): Map<string, any> | null => {
//       const svcAny: any = measurementService as any;
//       const store = svcAny.measurements || svcAny._measurements;
//       if (!store || !(store instanceof Map)) {
//         return null;
//       }
//       return store;
//     };

//     const measurementExists = (uid: string): boolean => {
//       const store = getMeasurementStore();
//       return !!store && store.has(uid);
//     };

//     const getDefaultViewportId = (): string | null => {
//       try {
//         if (!viewportGridService || typeof viewportGridService.getState !== 'function') {
//           console.warn(
//             '[camomille-annotator-link] viewportGridService or getState not available.'
//           );
//           return null;
//         }

//         const state = viewportGridService.getState();
//         const activeId = state?.activeViewportId;
//         if (activeId) return activeId;

//         const first = state?.viewports && state.viewports[0];
//         const firstId = first?.viewportId;
//         if (firstId) return firstId;

//         console.warn(
//           '[camomille-annotator-link] viewportGridService.getState() has no activeViewportId or viewports[0].'
//         );
//         return null;
//       } catch (err) {
//         console.error(
//           '[camomille-annotator-link] Error in getDefaultViewportId:',
//           err
//         );
//         return null;
//       }
//     };

//     const getOrientationFromNormal = (n?: number[] | Float32Array): 'axial' | 'sagittal' | 'coronal' | null => {
//       if (!n || n.length < 3) return null;
//       const [x, y, z] = n;
//       const ax = Math.abs(x);
//       const ay = Math.abs(y);
//       const az = Math.abs(z);

//       if (az >= ax && az >= ay) return 'axial';
//       if (ax >= ay && ax >= az) return 'sagittal';
//       if (ay >= ax && ay >= az) return 'coronal';
//       return null;
//     };

//     // ---------------- Gestion des événements MeasurementService ----------------

//     const handleMeasurementAdded = ({
//       source,
//       measurement,
//       data,
//       dataSource
//     }: {
//       source: any;
//       measurement: any;
//       data: any;
//       dataSource: any;
//     }) => {
//       const core = buildCoreFromMeasurement(measurement);
//       if (!core) return;

//       console.log(
//         '[camomille-annotator-link] measurement ADDED -> source :',
//         source
//       );

//       const payload: MeasurementAddedOrUpdatedPayload = {
//         type: 'ohif-meningioma-measurement-added',
//         measurementUID: core.uid,
//         measurement: core,
//       };

//       console.log(
//         '[camomille-annotator-link] measurement ADDED -> payload :',
//         payload
//       );

//       try {
//         window.parent?.postMessage(payload, '*');
//       } catch (err) {
//         console.error(
//           '[camomille-annotator-link] Failed to post measurement ADDED to parent:',
//           err
//         );
//       }
//     };

//     const handleMeasurementUpdated = ({
//       source,
//       measurement,
//     }: {
//       source: any;
//       measurement: any;
//     }) => {
//       console.log(
//         '[camomille-annotator-link] measurement UPDATED -> measurement :',
//         measurement
//       );

//       // --- RÉINJECTION DES METADATA POUR LES ANNOTATIONS BOOTSTRAPÉES ---
//       const measurementUID: string | undefined =
//         measurement.measurementUID ?? measurement.uid;

//       if (measurementUID && bootstrapMetadataByUID.has(measurementUID)) {
//         const preservedMeta = bootstrapMetadataByUID.get(measurementUID);

//         // Fusion : on garde ce que Cornerstone vient de mettre,
//         // mais on ré-applique les infos volumétriques d’origine.
//         measurement.metadata = {
//           ...(measurement.metadata || {}),
//           ...preservedMeta,
//         };

//         console.log(
//           '[camomille-annotator-link] Re-applied preserved metadata for UPDATED bootstrap measurement UID =',
//           measurementUID,
//           'metadata =',
//           measurement.metadata
//         );
//       }

//       const core = buildCoreFromMeasurement(measurement);
//       if (!core) return;
//       console.log(
//         '[camomille-annotator-link] measurement UPDATED -> core :',
//         core
//       );

//       const payload: MeasurementAddedOrUpdatedPayload = {
//         type: 'ohif-meningioma-measurement-updated',
//         measurementUID: core.uid,
//         measurement: core,
//       };

//       console.log(
//         '[camomille-annotator-link] measurement UPDATED -> payload :',
//         payload
//       );

//       try {
//         window.parent?.postMessage(payload, '*');
//       } catch (err) {
//         console.error(
//           '[camomille-annotator-link] Failed to post measurement UPDATED to parent:',
//           err
//         );
//       }
//     };


//     const handleMeasurementRemoved = ({
//       source,
//       measurement,
//     }: {
//       source: any;
//       measurement: string;
//     }) => {
//       const measurementUID = measurement;
//       if (!measurementUID) return;

//       const payload: MeasurementRemovedPayload = {
//         type: 'ohif-meningioma-measurement-removed',
//         measurementUID,
//       };

//       console.log(
//         '[camomille-annotator-link] measurement REMOVED -> payload :',
//         payload
//       );

//       try {
//         window.parent?.postMessage(payload, '*');
//       } catch (err) {
//         console.error(
//           '[camomille-annotator-link] Failed to post measurement REMOVED to parent:',
//           err
//         );
//       }
//     };

//     const subscriptions = [
//       measurementService.subscribe(
//         EVENTS.MEASUREMENT_ADDED,
//         handleMeasurementAdded
//       ),
//       measurementService.subscribe(
//         EVENTS.MEASUREMENT_UPDATED,
//         handleMeasurementUpdated
//       ),
//       measurementService.subscribe(
//         EVENTS.MEASUREMENT_REMOVED,
//         handleMeasurementRemoved
//       ),
//     ];

//     // ---------------- File d’attente pour bootstrap ----------------

//     let pendingBootstraps: BootstrapMeningiomaMessage[] = [];
//     let bootstrapRetryTimer: number | null = null;

// const processBootstrapNow = (msg: BootstrapMeningiomaMessage) => {
//   const { measurements } = msg;

//   if (!Array.isArray(measurements) || measurements.length === 0) {
//     console.log(
//       '[camomille-annotator-link] Bootstrap message received but measurements is empty.'
//     );
//     return;
//   }

//   const targetViewportId =
//     msg.viewportId || getDefaultViewportId();

//   if (!targetViewportId) {
//     console.warn(
//       '[camomille-annotator-link] No target viewportId for bootstrap; aborting for now.'
//     );
//     pendingBootstraps.push(msg);
//     scheduleBootstrapRetry();
//     return;
//   }

//   console.log(
//     '[camomille-annotator-link] Processing bootstrap on viewportId =',
//     targetViewportId
//   );

//   for (const core of measurements) {
//     try {
//       if (!core) {
//         console.warn(
//           '[camomille-annotator-link] core is null/undefined, skipping.'
//         );
//         continue;
//       }

//       if (!core.measurementUID && !core.uid) {
//         console.warn(
//           '[camomille-annotator-link] core without measurementUID/uid, skipping:',
//           core
//         );
//         continue;
//       }

//       const measurementUID = core.measurementUID ?? core.uid;

//       if (core.metadata) {
//         bootstrapMetadataByUID.set(measurementUID, core.metadata);
//       }

//       if (measurementExists(measurementUID)) {
//         console.log(
//           '[camomille-annotator-link] measurement already exists in service, skipping UID =',
//           measurementUID
//         );
//         continue;
//       }

//       // --- RÉCUPÉRATION ROBUSTE DES POINTS ---
//       let rawPoints: any =
//         core.points ??
//         core.data?.handles?.points ??
//         core.metadata?.points;

//       if (!rawPoints || !Array.isArray(rawPoints) || rawPoints.length < 2) {
//         console.warn(
//           '[camomille-annotator-link] Not enough points to hydrate ArrowAnnotate for UID =',
//           measurementUID,
//           'rawPoints =',
//           rawPoints
//         );
//         continue;
//       }

//       const pts = normalizePoints(rawPoints);
//       if (pts.length < 2) {
//         console.warn(
//           '[camomille-annotator-link] normalizePoints produced < 2 points for UID =',
//           measurementUID,
//           'rawPoints =',
//           rawPoints
//         );
//         continue;
//       }

//       const text = core.label ?? core.measurementUID ?? core.uid ?? '';

//       console.log(
//         '[camomille-annotator-link] Hydrating ArrowAnnotateTool for UID =',
//         measurementUID,
//         'on viewportId =',
//         targetViewportId,
//         'points =',
//         pts,
//         'text =',
//         text
//       );

//       // 1) Création de l’annotation Cornerstone
//       ArrowAnnotateTool.hydrate(
//         targetViewportId,
//         pts as any,
//         text,
//         {
//           annotationUID: measurementUID,
//         }
//       );

//       // 2) PATCH METADATA DANS LE STORE
//       const store = getMeasurementStore();
//       if (store && store.has(measurementUID)) {
//         const internal = store.get(measurementUID);
//         console.log(
//           '[camomille-annotator-link] internal(before patch) =',
//           internal
//         );

//         // Fusion : on garde ce que hydrate a mis,
//         // mais on ajoute tout ce que core.metadata contient (sliceIndex, planeRestriction, volumeId, etc.)
//         internal.metadata = {
//           ...(internal.metadata || {}),
//           ...(core.metadata || {}),
//         };

//         // Au cas où certaines infos sont au top level dans core :
//         internal.studyInstanceUID =
//           core.studyInstanceUID ??
//           core.referenceStudyUID ??
//           internal.studyInstanceUID;

//         internal.seriesInstanceUID =
//           core.seriesInstanceUID ??
//           core.referenceSeriesUID ??
//           internal.seriesInstanceUID;

//         internal.sopInstanceUID =
//           core.sopInstanceUID ??
//           core.SOPInstanceUID ??
//           internal.sopInstanceUID;

//         internal.FrameOfReferenceUID =
//           core.FrameOfReferenceUID ?? internal.FrameOfReferenceUID;
//         internal.frameOfReferenceUID =
//           core.frameOfReferenceUID ?? internal.frameOfReferenceUID;

//         // Scanner : referencedImageId éventuellement utile
//         internal.referencedImageId =
//           core.referencedImageId ??
//           core.metadata?.referencedImageId ??
//           internal.referencedImageId;

//         console.log(
//           '[camomille-annotator-link] internal(after patch) =',
//           internal
//         );
//       } else {
//         console.warn(
//           '[camomille-annotator-link] Could not find measurement in store after hydrate for UID =',
//           measurementUID
//         );
//       }
//     } catch (err) {
//       console.error(
//         '[camomille-annotator-link] Failed to hydrate annotation from core:',
//         core,
//         err
//       );
//     }
//   }
// };



//     const tryProcessPendingBootstraps = () => {
//       if (!pendingBootstraps.length) {
//         if (bootstrapRetryTimer !== null) {
//           window.clearInterval(bootstrapRetryTimer);
//           bootstrapRetryTimer = null;
//         }
//         return;
//       }

//       const viewportId = getDefaultViewportId();
//       if (!viewportId) {
//         // Toujours pas de viewport, on réessaiera plus tard
//         console.log(
//           '[camomille-annotator-link] Still no viewportId on retry; pendingBootstraps length =',
//           pendingBootstraps.length
//         );
//         return;
//       }

//       console.log(
//         '[camomille-annotator-link] Viewport now available (',
//         viewportId,
//         '), processing pending bootstraps…'
//       );

//       const toProcess = [...pendingBootstraps];
//       pendingBootstraps = [];

//       for (const msg of toProcess) {
//         processBootstrapNow({
//           ...msg,
//           viewportId,
//         });
//       }

//       // S’il en reste (échec ponctuel), ils seront remis dans pendingBootstraps
//       if (!pendingBootstraps.length && bootstrapRetryTimer !== null) {
//         window.clearInterval(bootstrapRetryTimer);
//         bootstrapRetryTimer = null;
//       }
//     };

//     const scheduleBootstrapRetry = () => {
//       if (bootstrapRetryTimer !== null) {
//         return;
//       }
//       // On poll toutes les 500ms jusqu’à ce qu’un viewport apparaisse
//       bootstrapRetryTimer = window.setInterval(tryProcessPendingBootstraps, 500);
//     };

//     // ---------------- Listener parent → OHIF ----------------

//     const messageListener = (event: MessageEvent) => {
//       const data = event.data as AnyIncomingMessage;
//       if (!data) return;

//       // 1) Jump direct vers une lésion
//       if (data.type === 'ohif-meningioma-jump-to-measurement') {
//         const { measurementUID, viewportId } = data;

//         console.log(
//           '[camomille-annotator-link] jump-to-measurement message received:',
//           data
//         );

//         const store = getMeasurementStore();
//         console.log(
//           '[camomille-annotator-link] measurementService.measurements keys =',
//           store ? Array.from(store.keys()) : 'NO STORE'
//         );
//         console.log(
//           '[camomille-annotator-link] store.get(measurementUID) =',
//           store ? store.get(measurementUID) : 'NO STORE'
//         );

//         try {
//           measurementService.jumpToMeasurement(
//             viewportId ?? null,
//             measurementUID
//           );
//         } catch (err) {
//           console.error(
//             '[camomille-annotator-link] Failed to jumpToMeasurement:',
//             err
//           );
//         }
//         return;
//       }

//       // 2) Bootstrap des mesures
//       if (data.type === 'ohif-meningioma-bootstrap-measurements') {
//         console.log(
//           '[camomille-annotator-link] Bootstrap measurements received:',
//           data.measurements
//         );

//         // On tente immédiatement, sinon on met en attente
//         processBootstrapNow(data);
//         return;
//       }
//     };

//     window.addEventListener('message', messageListener);

//     window.__OHIF_MENINGIOMA_LINK__ = {
//       ...(window.__OHIF_MENINGIOMA_LINK__ || {}),
//       subscriptions,
//       messageListener,
//     };

//     console.log(
//       '[camomille-annotator-link] preRegistration completed (MeasurementService wired).'
//     );
//   },

//   getPanelModule: () => null,
// };
