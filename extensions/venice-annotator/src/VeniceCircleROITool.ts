import * as csTools from '@cornerstonejs/tools';

export class VeniceCircleROITool extends (csTools as any).CircleROITool {
    static toolName = 'VeniceCircleROI';

    getTextLines(data: any, ...rest: any[]) {
        const lines = super.getTextLines?.(data, ...rest) ?? [];
        const label = (data?.label ?? '').trim();
        if (!label) return lines;
        return [label, ...lines];
    }
}
