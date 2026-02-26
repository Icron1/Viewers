/** @type {AppTypes.Config} */
window.config = {
    routerBasename: '/ohif',
    showStudyList: false,
    extensions: [],
    modes: [],
    // below flag is for performance reasons, but it might not work for all servers
    showWarningMessageForCrossOrigin: true,
    showCPUFallbackMessage: true,
    showLoadingIndicator: true,
    experimentalStudyBrowserSort: false,
    strictZSpacingForVolumeViewport: true,
    showPatientInfo: 'disabled',
    investigationalUseDialog: {
        option: 'never',
    },
    // studyPrefetcher: {
    //   enabled: true,
    //   displaySetsCount: 2,
    //   maxNumPrefetchRequests: 10,
    //   order: 'closest',
    // },
    defaultDataSourceName: 'orthancLocal',
    dataSources: [
        {
            namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
            sourceName: 'orthancLocal',
            configuration: {
                friendlyName: 'Orthanc (local)',
                name: 'OrthancLocal',

                // Orthanc en direct (sans nginx)
                wadoUriRoot: '/wado',
                qidoRoot: '/dicom-web',
                wadoRoot: '/dicom-web',

                qidoSupportsIncludeField: false,
                imageRendering: 'wadors',
                thumbnailRendering: 'wadors',
                dicomUploadEnabled: true,
                omitQuotationForMultipartRequest: true,
            },
        },
    ],
    httpErrorHandler: error => {
        console.warn(`HTTP Error Handler (status: ${error.status})`, error);
    },
};
