import * as React from 'react';

import { LiveVisionPipelineViewProps } from './LiveVisionPipeline.types';

export default function LiveVisionPipelineView(props: LiveVisionPipelineViewProps) {
  return (
    <div>
      <iframe
        style={{ flex: 1 }}
        src={props.url}
        onLoad={() => props.onLoad({ nativeEvent: { url: props.url } })}
      />
    </div>
  );
}
