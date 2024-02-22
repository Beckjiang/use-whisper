export type UseWhisperConfig = {
  apiEndpoint?: string
  apiKey?: string
  autoStart?: boolean
  autoTranscribe?: boolean
  autoTranscribeOnStop?: boolean
  mode?: 'transcriptions' | 'translations'
  nonStop?: boolean
  removeSilence?: boolean
  stopTimeout?: number
  streaming?: boolean
  timeSlice?: number
  transcribeSliceCount?: number
  whisperConfig?: WhisperApiConfig
  onStartRecording?: (stream: MediaStream) => void
  onDataAvailable?: (blob: Blob) => void
  onTranscribe?: (blob: Blob) => Promise<UseWhisperTranscript>
  onTranscribeFinished?: (text: any, blob: Blob) => void
}

export type UseWhisperTimeout = {
  stop?: NodeJS.Timeout
}

export type Segment = {
  start: number // in milliseconds
  end: number
  text: string
}

export type UseWhisperTranscript = {
  start?: number
  end?: number
  blob?: Blob
  text?: string
  segment?: Segment
  segments?: Segment[]
  stopped?: boolean
}

export type UseWhisperReturn = {
  recording: boolean
  speaking: boolean
  transcribing: boolean
  transcript: UseWhisperTranscript
  pauseRecording: () => Promise<void>
  startRecording: () => Promise<void>
  stopRecording: () => Promise<void>
  reset: () => Promise<void>
  transcribeFileBlob: (blob: Blob, type: string) => Promise<string | undefined>
}

export type UseWhisperHook = (config?: UseWhisperConfig) => UseWhisperReturn

export type WhisperApiConfig = {
  model?: 'whisper-1' | string
  prompt?: string
  response_format?: 'json' | 'text' | 'srt' | 'verbose_json' | 'vtt'
  temperature?: number
  language?: string
  endpoint?: string
}
