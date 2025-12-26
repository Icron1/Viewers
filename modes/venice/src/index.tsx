// Viewers\modes\camomille\src\index.tsx
import i18n from 'i18next';
import { id } from './id';
import { 
  toolbarButtons, 
  cornerstone,
  segmentation,
  dicomRT,
  extensionDependencies,
  ohif
 } from '@ohif/mode-basic';
import initToolGroups from './initToolGroups';
import { primaryAxialCustom } from './primaryAxialCustom';

function modeFactory({ modeConfiguration }) {
  return {
    id,
    routeName: 'venice',
    displayName: 'Venice',

    onModeEnter: ({ servicesManager, extensionManager, commandsManager }: withAppTypes) => {
      const {
        measurementService,
        toolbarService,
        toolGroupService,
        customizationService
      } = servicesManager.services;

      measurementService.clearMeasurements();

      // Init Default and SR ToolGroups
      initToolGroups(extensionManager, toolGroupService, commandsManager);

      toolbarService.register(toolbarButtons);

      toolbarService.updateSection(toolbarService.sections.primary, [
        'StackScroll',
        'WindowLevel',
        'Pan',
        'Zoom',
        'Crosshairs',
        'Layout',
        'Reset',
        'Length',
        'ArrowAnnotate',
        'CircleROI',
        'MeasurementTools',
      ]);

      toolbarService.updateSection('MeasurementTools', [
        'Bidirectional',
        'EllipticalROI',
        'RectangleROI',
        'PlanarFreehandROI',
        'SplineROI',
        'LivewireContour',
      ]);

      toolbarService.updateSection(
        toolbarService.sections.viewportActionMenu.topLeft,
        ['orientationMenu', 'dataOverlayMenu']
      );

      toolbarService.updateSection(
        toolbarService.sections.viewportActionMenu.bottomMiddle,
        ['AdvancedRenderingControls']
      );

      toolbarService.updateSection('AdvancedRenderingControls', [
        'windowLevelMenuEmbedded',
        'voiManualControlMenu',
        'Colorbar',
        'opacityMenu',
        'thresholdMenu',
      ]);

      toolbarService.updateSection(
        toolbarService.sections.viewportActionMenu.topRight,
        ['modalityLoadBadge', 'trackingStatus', 'navigationComponent']
      );

      toolbarService.updateSection(
        toolbarService.sections.viewportActionMenu.bottomLeft,
        ['windowLevelMenu']
      );

            customizationService.setCustomizations({
        'ohif.hotkeyBindings': {
          $push: [
            {
              commandName: 'setToolActive',
              commandOptions: { toolName: 'StackScroll' },
              label: 'Activer StackScroll',
              keys: ['b'],        // B → StackScroll
              isEditable: true,
            },
            {
              commandName: 'setToolActive',
              commandOptions: { toolName: 'Length' },
              label: 'Activer la règle (Length)',
              keys: ['l'],        // L → Length
              isEditable: true,
            },
            {
              commandName: 'setToolActive',
              commandOptions: { toolName: 'CircleROI' },
              label: 'Activer la ROI circulaire (CircleROI)',
              keys: ['c'],        // C → CircleROI
              isEditable: true,
            },
            {
              commandName: 'setToolActive',
              commandOptions: { toolName: 'ArrowAnnotate' },
              label: 'Activer la flèche (ArrowAnnotate)',
              keys: ['a'],        // A → ArrowAnnotate
              isEditable: true,
            },
          ],
        },
      });      
    },

    onModeExit: ({ servicesManager }: withAppTypes) => {
      const {
        toolGroupService,
        syncGroupService,
        segmentationService,
        cornerstoneViewportService,
        uiDialogService,
        uiModalService,
      } = servicesManager.services;

      uiDialogService.hideAll();
      uiModalService.hide();
      toolGroupService.destroy();
      syncGroupService.destroy();
      segmentationService.destroy();
      cornerstoneViewportService.destroy();
    },

    validationTags: {
      study: [],
      series: [],
    },

    isValidMode: ({ modalities }) => {
      const modalitiesArray = modalities.split('\\');
      return {
        valid:
          modalitiesArray.length === 1
            ? !['SM', 'ECG', 'OT', 'DOC'].includes(modalitiesArray[0])
            : true,
        description:
          'The mode does not support studies that ONLY include the following modalities: SM, OT, DOC',
      };
    },

    routes: [
      {
        path: 'venice',
        layoutTemplate: ({ location, servicesManager }) => {
          return {
            id: ohif.layout,
            props: {
              leftPanels: [],
              leftPanelClosed: true,
              rightPanelClosed: true,
              viewports: [
                {
                  namespace: cornerstone.viewport,
                  displaySetsToDisplay: [ohif.sopClassHandler],
                },
              ],
            },
          };
        },
      },
    ],

    extensions: extensionDependencies,
    hangingProtocol: ['primaryAxialCustom'], 
    hangingProtocols: [primaryAxialCustom],
    sopClassHandlers: [
      ohif.sopClassHandler,
      segmentation.sopClassHandler,
      dicomRT.sopClassHandler,
    ],

    ...modeConfiguration,
  };
}

const mode = {
  id,
  modeFactory,
  extensionDependencies,
};

export default mode;
export { initToolGroups, toolbarButtons };