import { useEffectAsync, useMemoAsync } from '@chengsokdara/react-hooks-async'
import type { RawAxiosRequestHeaders } from 'axios'
import type { Harker } from 'hark'
import type { Encoder } from 'lamejs'
import { useEffect, useRef, useState } from 'react'
// import type { Options, RecordRTCPromisesHandler } from 'recordrtc'
import { CustomRTCPromisesHandler } from './record'
import {
  defaultStopTimeout,
  ffmpegCoreUrl,
  silenceRemoveCommand,
  whisperApiEndpoint,
} from './configs'
import {
  UseWhisperConfig,
  UseWhisperHook,
  UseWhisperTimeout,
  UseWhisperTranscript,
} from './types'

/**
 * default useWhisper configuration
 */
const defaultConfig: UseWhisperConfig = {
  apiKey: '',
  autoStart: false,
  autoTranscribe: true,
  autoTranscribeOnStop: true,
  mode: 'transcriptions',
  nonStop: false,
  removeSilence: false,
  stopTimeout: defaultStopTimeout,
  streaming: false,
  timeSlice: 1_000,
  transcribeSliceCount: 10,
  onDataAvailable: undefined,
  onTranscribe: undefined,
}

/**
 * default timeout for recorder
 */
const defaultTimeout: UseWhisperTimeout = {
  stop: undefined,
}

/**
 * default transcript object
 */
const defaultTranscript: UseWhisperTranscript = {
  blob: undefined,
  text: undefined,
}

const fileTypeExtMap = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/mpeg': 'mp3',
  'audio/m4a': 'm4a',
}

/**
 * React Hook for OpenAI Whisper
 */
export const useWhisper: UseWhisperHook = (config) => {
  const {
    apiKey,
    autoStart,
    autoTranscribe,
    autoTranscribeOnStop,
    mode,
    nonStop,
    removeSilence,
    stopTimeout,
    streaming,
    timeSlice,
    whisperConfig,
    onStartRecording: onStartRecordingCallback,
    onDataAvailable: onDataAvailableCallback,
    onTranscribe: onTranscribeCallback,
    onTranscribeFinished: onTranscribeFinishedCallback,
  } = {
    ...defaultConfig,
    ...config,
  }

  if (!apiKey && !onTranscribeCallback) {
    throw new Error('apiKey is required if onTranscribe is not provided')
  }

  const chunks = useRef<Blob[]>([])
  const encoder = useRef<Encoder>()
  const listener = useRef<Harker>()
  const recorder = useRef<CustomRTCPromisesHandler>()
  const stream = useRef<MediaStream>()
  const timeout = useRef<UseWhisperTimeout>(defaultTimeout)

  const [recording, setRecording] = useState<boolean>(false)
  const [speaking, setSpeaking] = useState<boolean>(false)
  const [transcribing, setTranscribing] = useState<boolean>(false)
  const [transcript, setTranscript] =
    useState<UseWhisperTranscript>(defaultTranscript)

  const workerRef = useRef<Worker | null>(null)
  const sliceNums = useRef<number>(1)
  const currentSection = useRef<Blob[]>([])
  const elapsedTime = useRef<number>(0)
  const startTime = useRef<number>(0)

  /**
   * cleanup on component unmounted
   * - flush out and cleanup lamejs encoder instance
   * - destroy recordrtc instance and clear it from ref
   * - clear setTimout for onStopRecording
   * - clean up hark speaking detection listeners and clear it from ref
   * - stop all user's media steaming track and remove it from ref
   */
  useEffect(() => {
    return () => {
      if (chunks.current) {
        chunks.current = []
      }
      if (encoder.current) {
        encoder.current.flush()
        encoder.current = undefined
      }
      if (recorder.current) {
        recorder.current.destroy()
        recorder.current = undefined
      }
      onStopTimeout('stop')
      if (listener.current) {
        // @ts-ignore
        listener.current.off('speaking', onStartSpeaking)
        // @ts-ignore
        listener.current.off('stopped_speaking', onStopSpeaking)
      }
      if (stream.current) {
        stream.current.getTracks().forEach((track) => track.stop())
        stream.current = undefined
      }
      if (workerRef.current) {
        workerRef.current.terminate()
      }
    }
  }, [])

  /**
   * if config.autoStart is true
   * start speech recording immediately upon component mounted
   */
  useEffectAsync(async () => {
    if (autoStart) {
      await onStartRecording()
    }
  }, [autoStart])

  /**
   * start speech recording and start listen for speaking event
   */
  const startRecording = async () => {
    await onStartRecording()
  }

  /**
   * pause speech recording also stop media stream
   */
  const pauseRecording = async () => {
    await onPauseRecording()
  }

  const reset = async () => {
    await onReset()
  }

  /**
   * stop speech recording and start the transcription
   */
  const stopRecording = async () => {
    await onStopRecording()
  }

  /**
   * start speech recording event
   * - first ask user for media stream
   * - create recordrtc instance and pass media stream to it
   * - create lamejs encoder instance
   * - check recorder state and start or resume recorder accordingly
   * - start timeout for stop timeout config
   * - update recording state to true
   */
  const onStartRecording = async () => {
    try {
      if (!stream.current) {
        await onStartStreaming()
      }
      if (stream.current) {
        if (!recorder.current) {
          // const {
          //   default: { RecordRTCPromisesHandler, StereoAudioRecorder },
          // } = await import('recordrtc')
          // const recorderConfig: Options = {
          //   mimeType: 'audio/wav',
          //   numberOfAudioChannels: 1, // mono
          //   recorderType: StereoAudioRecorder,
          //   sampleRate: 44100, // Sample rate = 44.1khz
          //   timeSlice: streaming ? timeSlice : undefined,
          //   type: 'audio',
          //   ondataavailable:
          //     autoTranscribe && streaming ? onDataAvailable : undefined,
          // }
          const recorderConfig = {
            mimeType: 'audio/webm',
            ondataavailable:
              autoTranscribe && streaming ? onDataAvailable : undefined,
            onstopped: (blob: Blob) => {
              console.log('onstopped', blob)
            },
            timeSlice: streaming ? timeSlice : undefined,
          }
          recorder.current = new CustomRTCPromisesHandler(
            stream.current,
            recorderConfig
          )
        }
        if (!encoder.current) {
          const { Mp3Encoder } = await import('lamejs')
          encoder.current = new Mp3Encoder(1, 44100, 96)
        }
        if (!workerRef.current) {
          workerRef.current = new Worker(
            new URL('./worker.js', import.meta.url)
          )
          workerRef.current.postMessage({ command: 'init' })
        }
        const recordState = await recorder.current.getState()
        if (recordState === 'inactive' || recordState === 'stopped') {
          await recorder.current.startRecording()
        }
        if (recordState === 'paused') {
          await recorder.current.resumeRecording()
        }
        if (nonStop) {
          onStartTimeout('stop')
        }
        onStartRecordingCallback?.(stream.current)
        setRecording(true)
        startTime.current = Date.now()
      }
    } catch (err) {
      console.error(err)
    }
  }

  /**
   * get user media stream event
   * - try to stop all previous media streams
   * - ask user for media stream with a system popup
   * - register hark speaking detection listeners
   */
  const onStartStreaming = async () => {
    try {
      if (stream.current) {
        stream.current.getTracks().forEach((track) => track.stop())
      }
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: true,
      })
      if (!listener.current) {
        const { default: hark } = await import('hark')
        listener.current = hark(stream.current, {
          interval: 100,
          play: false,
        })
        listener.current.on('speaking', onStartSpeaking)
        listener.current.on('stopped_speaking', onStopSpeaking)
      }
    } catch (err) {
      console.error(err)
    }
  }

  /**
   * start stop timeout event
   */
  const onStartTimeout = (type: keyof UseWhisperTimeout) => {
    if (!timeout.current[type]) {
      timeout.current[type] = setTimeout(onStopRecording, stopTimeout)
    }
  }

  /**
   * user start speaking event
   * - set speaking state to true
   * - clear stop timeout
   */
  const onStartSpeaking = () => {
    console.log('start speaking')
    setSpeaking(true)
    const currentRecordingTime = getCurrentRecordingTime()
    setTranscript((prev) => {
      return {
        ...prev,
        start: currentRecordingTime,
      }
    })
    onStopTimeout('stop')
  }

  /**
   * user stop speaking event
   * - set speaking state to false
   * - start stop timeout back
   */
  const onStopSpeaking = () => {
    console.log('stop speaking')
    setSpeaking(false)
    const copy_section = [...currentSection.current]
    currentSection.current = []
    const data = new Blob(copy_section, {
      type: 'audio/webm',
    })

    doTranscribing(data, 'audio/webm', true).then((res) => {
      console.log('after onStopSpeaking doTranscribing')
      console.log(res)
    })

    if (nonStop) {
      onStartTimeout('stop')
    }
  }

  /**
   * pause speech recording event
   * - if recorder state is recording, pause the recorder
   * - clear stop timeout
   * - set recoriding state to false
   */
  const onPauseRecording = async () => {
    try {
      if (recorder.current) {
        const recordState = await recorder.current.getState()
        if (recording) {
          elapsedTime.current += Date.now() - startTime.current
        }
        if (recordState === 'recording') {
          await recorder.current.pauseRecording()
        }
        onStopTimeout('stop')
        setRecording(false)
      }
    } catch (err) {
      console.error(err)
    }
  }

  const getCurrentRecordingTime = () => {
    if (recording) {
      // 如果正在录音，计算当前段的持续时间并加到总时间
      return elapsedTime.current + (Date.now() - startTime.current)
    } else {
      // 如果不在录音，返回已录制的总时间
      return elapsedTime.current
    }
  }

  const onReset = async () => {
    try {
      if (recorder.current) {
        const recordState = await recorder.current.getState()
        if (recording) {
          elapsedTime.current += Date.now() - startTime.current
        }
        if (recordState === 'recording' || recordState === 'paused') {
          await recorder.current.reset()
        }
        if (nonStop) {
          onStartTimeout('stop')
        }
        setRecording(false)
      }
    } catch (err) {
      console.error(err)
    }
  }

  /**
   * stop speech recording event
   * - flush out lamejs encoder and set it to undefined
   * - if recorder state is recording or paused, stop the recorder
   * - stop user media stream
   * - clear stop timeout
   * - set recording state to false
   * - start Whisper transcription event
   * - destroy recordrtc instance and clear it from ref
   */
  const onStopRecording = async () => {
    try {
      if (recorder.current) {
        const recordState = await recorder.current.getState()
        if (recording) {
          elapsedTime.current += Date.now() - startTime.current
        }
        if (recordState === 'recording' || recordState === 'paused') {
          await recorder.current.stopRecording()
        }
        onStopStreaming()
        onStopTimeout('stop')
        setRecording(false)
        if (autoTranscribeOnStop) {
          await onTranscribing()
        } else {
          const blob_webm = await recorder.current.getBlob()

          setTranscript({
            blob: blob_webm,
          })
          if (typeof onTranscribeFinishedCallback === 'function') {
            console.log('onstop', blob_webm.size)
            onTranscribeFinishedCallback('', blob_webm)
          }
        }
        await recorder.current.destroy()
        chunks.current = []
        if (encoder.current) {
          encoder.current.flush()
          encoder.current = undefined
        }
        recorder.current = undefined
      }
    } catch (err) {
      console.error(err)
    }
  }

  /**
   * stop media stream event
   * - remove hark speaking detection listeners
   * - stop all media stream tracks
   * - clear media stream from ref
   */
  const onStopStreaming = () => {
    if (listener.current) {
      // @ts-ignore
      listener.current.off('speaking', onStartSpeaking)
      // @ts-ignore
      listener.current.off('stopped_speaking', onStopSpeaking)
      listener.current = undefined
    }
    if (stream.current) {
      stream.current.getTracks().forEach((track) => track.stop())
      stream.current = undefined
    }
  }

  /**
   * stop timeout event
   * - clear stop timeout and remove it from ref
   */
  const onStopTimeout = (type: keyof UseWhisperTimeout) => {
    if (timeout.current[type]) {
      clearTimeout(timeout.current[type])
      timeout.current[type] = undefined
    }
  }

  const doTranscribing = async (
    blob: Blob,
    type?: string,
    stopped?: boolean
  ) => {
    // setTranscript((prev) => ({
    //   ...prev,
    //   blob,
    // }))
    let text = ''
    let result: UseWhisperTranscript = {}
    if (typeof onTranscribeCallback === 'function') {
      const transcribed = await onTranscribeCallback(blob)
      console.log('onTranscribe', transcribed)
      setTranscript(transcribed)
      // if (typeof onTranscribeFinishedCallback === 'function') {
      //   onTranscribeFinishedCallback(transcribed.text || '', blob)
      // }
      text = transcribed.text || ''
      // TODO: result
    } else {
      const fileType = type || 'audio/webm'
      const fileExt = fileTypeExtMap[fileType]

      const file = new File([blob], 'speech.' + fileExt, { type: fileType })
      const transcribeResult = await onWhispered(file)
      text = transcribeResult.text || ''
      result = {
        start: getCurrentRecordingTime() || 0,
        end: getCurrentRecordingTime() + transcribeResult.duration,
        text,
        blob,
        stopped: stopped || false,
        segments: transcribeResult.segments || [],
      }
      console.log('onTranscribing result', result)
      setTranscript(result)

      // if (typeof onTranscribeFinishedCallback === 'function') {
      //   onTranscribeFinishedCallback(text || '', blob)
      // }
    }
    setTranscribing(false)
    return result
  }

  /**
   * start Whisper transcrition event
   * - make sure recorder state is stopped
   * - set transcribing state to true
   * - get audio blob from recordrtc
   * - if config.removeSilence is true, load ffmpeg-wasp and try to remove silence from speec
   * - if config.customServer is true, send audio data to custom server in base64 string
   * - if config.customServer is false, send audio data to Whisper api in multipart/form-data
   * - set transcript object with audio blob and transcription result from Whisper
   * - set transcribing state to false
   */
  const onTranscribing = async () => {
    console.log('transcribing speech')
    try {
      if (encoder.current && recorder.current) {
        const recordState = await recorder.current.getState()
        if (recordState === 'stopped') {
          setTranscribing(true)
          let blob = await recorder.current.getBlob()
          if (removeSilence) {
            const { createFFmpeg } = await import('@ffmpeg/ffmpeg')
            const ffmpeg = createFFmpeg({
              mainName: 'main',
              corePath: ffmpegCoreUrl,
              log: true,
            })
            if (!ffmpeg.isLoaded()) {
              await ffmpeg.load()
            }
            const buffer = await blob.arrayBuffer()
            console.log({ in: buffer.byteLength })
            ffmpeg.FS('writeFile', 'in.webm', new Uint8Array(buffer))
            await ffmpeg.run(
              '-i', // Input
              'in.webm',
              '-acodec', // Audio codec
              'libmp3lame',
              '-b:a', // Audio bitrate
              '96k',
              '-ar', // Audio sample rate
              '44100',
              '-af', // Audio filter = remove silence from start to end with 2 seconds in between
              silenceRemoveCommand,
              'out.webm' // Output
            )
            const out = ffmpeg.FS('readFile', 'out.webm')
            console.log({ out: out.buffer.byteLength })
            // 225 seems to be empty mp3 file
            if (out.length <= 225) {
              ffmpeg.exit()
              setTranscript({
                blob,
              })
              setTranscribing(false)
              return
            }
            blob = new Blob([out.buffer], { type: 'audio/webm' })
            ffmpeg.exit()

            await doTranscribing(blob)
          } else {
            const buffer = await blob.arrayBuffer()
            console.log({ wav: buffer.byteLength })
            if (workerRef.current) {
              workerRef.current.postMessage({ command: 'encode', data: blob })

              workerRef.current.onmessage = (event) => {
                const blob = event.data
                // ...后续操作
                doTranscribing(blob).then(() => {
                  console.log(
                    'after workerRef.current.onmessage doTranscribing'
                  )
                })
              }
            } else {
              // mp3 = encoder.current.encodeBuffer(new Int16Array(buffer))
              // blob = new Blob([mp3], { type: 'audio/webm' })
              console.log({ blob, length: blob.size })
              await doTranscribing(blob)
              console.log('after encoder.current.encodeBuffer doTranscribing')
            }
          }
        }
      }
    } catch (err) {
      console.info(err)
      setTranscribing(false)
    }
  }

  /**
   * Get audio data in chunk based on timeSlice
   * - while recording send audio chunk to Whisper
   * - chunks are concatenated in succession
   * - set transcript text with interim result
   */
  const onDataAvailable = async (data: Blob) => {
    const nums = sliceNums.current++
    console.log('onDataAvailable', data, nums)
    try {
      if (streaming && recorder.current) {
        onDataAvailableCallback?.(data)
        if (encoder.current) {
          // const buffer = await data.arrayBuffer()
          // const mp3chunk = encoder.current.encodeBuffer(new Int16Array(buffer))
          // const mp3blob = new Blob([mp3chunk], { type: 'audio/mpeg' })
          chunks.current.push(data)
          currentSection.current.push(data)
        }
        const recorderState = await recorder.current.getState()
        if (recorderState === 'recording') {
          // 切割音频后5块数据
          const blob = new Blob(chunks.current.slice(-10), {
            type: 'audio/webm',
          })
          const file = new File([blob], 'speech.webm', {
            type: 'audio/webm',
          })
          const resp = await onWhispered(file)
          const text = resp.text
          // console.log('onInterim', { text })
          if (text && timeSlice) {
            console.log('onInterim', { text })

            setTranscript((prev) => ({
              ...prev,
              text,
              stopped: false,
            }))
          }
        }
      }
    } catch (err) {
      console.error(err)
    }
  }

  const transcribeFileBlob = async (blob: Blob, type: string) => {
    try {
      return doTranscribing(blob, type)
    } catch (err) {
      console.error(err)
    }
  }

  /**
   * Send audio file to Whisper to be transcribed
   * - create formdata and append file, model, and language
   * - append more Whisper config if whisperConfig is provided
   * - add OpenAPI Token to header Authorization Bearer
   * - post with axios to OpenAI Whisper transcript endpoint
   * - return transcribed text result
   */
  const onWhispered = useMemoAsync(
    async (file: File) => {
      // Whisper only accept multipart/form-data currently
      const body = new FormData()
      body.append('file', file)
      body.append('model', 'whisper-1')
      if (mode === 'transcriptions') {
        body.append('language', whisperConfig?.language ?? 'en')
      }
      if (whisperConfig?.prompt) {
        body.append('prompt', whisperConfig.prompt)
      }
      if (whisperConfig?.response_format) {
        body.append('response_format', whisperConfig.response_format)
      }
      if (whisperConfig?.temperature) {
        body.append('temperature', `${whisperConfig.temperature}`)
      }
      const headers: RawAxiosRequestHeaders = {}
      headers['Content-Type'] = 'multipart/form-data'
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`
      }
      const { default: axios } = await import('axios')
      const endpoint = whisperConfig?.endpoint ?? whisperApiEndpoint
      const response = await axios.post(endpoint + mode, body, {
        headers,
      })
      return response.data
    },
    [apiKey, mode, whisperConfig]
  )

  return {
    recording,
    speaking,
    transcribing,
    transcript,
    pauseRecording,
    startRecording,
    stopRecording,
    reset,
    transcribeFileBlob,
  }
}
