Pod::Spec.new do |s|
  s.name           = 'LiveVisionPipeline'
  s.version        = '1.0.0'
  s.summary        = 'Bin2Bucks native live vision pipeline'
  s.description    = 'VisionCamera frame processor + ML Kit object tracking for Bin2Bucks live scanning.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '15.1'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'VisionCamera'
  s.dependency 'GoogleMLKit/ObjectDetection'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }
  s.swift_version = '5.9'

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
