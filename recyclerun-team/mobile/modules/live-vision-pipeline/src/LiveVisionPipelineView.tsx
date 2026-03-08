import { requireNativeView } from 'expo';
import * as React from 'react';

import { LiveVisionPipelineViewProps } from './LiveVisionPipeline.types';

const NativeView: React.ComponentType<LiveVisionPipelineViewProps> =
  requireNativeView('LiveVisionPipeline');

export default function LiveVisionPipelineView(props: LiveVisionPipelineViewProps) {
  return <NativeView {...props} />;
}
