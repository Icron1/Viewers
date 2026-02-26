import * as csTools from '@cornerstonejs/tools';

export class VeniceCircleROITool extends (csTools as any).CircleROITool {
    static toolName = 'CircleROI';

    // appelé quand on commence la création d'une annotation
    addNewAnnotation(evt: any) {
        console.log('[VENICE][CircleROI] addNewAnnotation ✅', {
            tool: (this as any).constructor?.name,
            toolName: (this as any).constructor?.toolName,
            evtType: evt?.type,
            detailKeys: evt?.detail ? Object.keys(evt.detail) : null,
        });

        const ann = super.addNewAnnotation(evt);

        console.log('[VENICE][CircleROI] created annotation ✅', {
            annotationUID: ann?.annotationUID,
            metadataToolName: ann?.metadata?.toolName,
            data: ann?.data,
        });

        return ann;
    }

    // on logue aussi renderAnnotation, mais sans dépendre d'un flag
    renderAnnotation(enabledElement: any, svgDrawingHelper: any) {
        console.log('[VENICE][CircleROI] renderAnnotation ✅', {
            tool: (this as any).constructor?.name,
            viewportId: enabledElement?.viewport?.id,
        });
        return super.renderAnnotation(enabledElement, svgDrawingHelper);
    }
}
