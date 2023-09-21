type State = 'inactive' | 'recording' | 'paused'

interface Options {
  mimeType?: string
  ondataavailable?: (blob: Blob) => void
  timeSlice?: number
}

class CustomRTCPromisesHandler {
  private mediaRecorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private stream: MediaStream
  private options: Options

  public blob: Blob | null = null
  public version = '1.0.0'

  constructor(
    stream: MediaStream | HTMLCanvasElement | HTMLVideoElement | HTMLElement,
    options?: Options
  ) {
    this.options = options || {}

    if (stream instanceof MediaStream) {
      this.stream = stream
    } else if (stream instanceof HTMLCanvasElement) {
      this.stream = (stream as any).captureStream()
    } else if (stream instanceof HTMLVideoElement) {
      this.stream = (stream as any).captureStream()
    } else {
      throw new Error('Unsupported input type.')
    }

    console.log(this.options.mimeType)
    if (MediaRecorder.isTypeSupported(this.options.mimeType || '')) {
      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType: this.options.mimeType,
      })

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.chunks.push(event.data)

          // If ondataavailable callback is provided and timeSlice is set
          if (this.options.ondataavailable && this.options.timeSlice) {
            this.options.ondataavailable(event.data)
          }
        }
      }

      this.mediaRecorder.onstop = () => {
        this.blob = new Blob(this.chunks, {
          type: this.options.mimeType || 'video/webm',
        })
        this.chunks = []
      }
    } else {
      throw new Error('MimeType not supported')
    }
  }

  async startRecording(): Promise<void> {
    if (!this.mediaRecorder) throw new Error('MediaRecorder not initialized')
    this.mediaRecorder.start(this.options.timeSlice)
    console.log('started')
  }

  async stopRecording(): Promise<string> {
    return new Promise((resolve, reject) => {
      console.log('stopped')
      console.log(this.mediaRecorder)
      console.log(this.blob)
      if (!this.mediaRecorder) {
        reject(
          new Error('MediaRecorder not initialized or recording not started')
        )
        return
      }
      this.mediaRecorder.stop()
      console.log(this.blob)
      resolve(URL.createObjectURL(this.blob || new Blob()))
    })
  }

  async pauseRecording(): Promise<void> {
    if (!this.mediaRecorder) throw new Error('MediaRecorder not initialized')
    this.mediaRecorder.pause()
  }

  async resumeRecording(): Promise<void> {
    if (!this.mediaRecorder) throw new Error('MediaRecorder not initialized')
    this.mediaRecorder.resume()
  }

  async getDataURL(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.blob) {
        reject(new Error('Recording not available.'))
        return
      }

      const reader = new FileReader()
      reader.onload = () => {
        resolve(reader.result as string)
      }
      reader.readAsDataURL(this.blob)
    })
  }

  async getBlob(): Promise<Blob> {
    if (!this.blob) throw new Error('Recording not available.')
    return this.blob
  }

  getInternalRecorder(): Promise<MediaRecorder> {
    if (!this.mediaRecorder) throw new Error('MediaRecorder not initialized')
    return Promise.resolve(this.mediaRecorder)
  }

  async reset(): Promise<void> {
    this.chunks = []
    this.blob = null
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop()
    }
  }

  async destroy(): Promise<void> {
    await this.reset()
    this.stream.getTracks().forEach((track) => track.stop())
  }

  async getState(): Promise<State> {
    if (!this.mediaRecorder) throw new Error('MediaRecorder not initialized')
    return this.mediaRecorder.state as State
  }
}

const startButton = document.getElementById('start')
const pauseButton = document.getElementById('pause')
const resumeButton = document.getElementById('resume')
const stopButton = document.getElementById('stop')
const playButton = document.getElementById('play')
const audioElement = document.getElementById('audio') as HTMLAudioElement

let handler: CustomRTCPromisesHandler

startButton?.addEventListener('click', async () => {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  handler = new CustomRTCPromisesHandler(stream, {
    mimeType: 'audio/webm',
    timeSlice: 1000,
    ondataavailable: (blob) => {
      console.log(blob)
    },
  })
  await handler.startRecording()

  //   startButton && startButton.disabled;
  //   stopButton && stopButton.disabled = false;
})

pauseButton?.addEventListener('click', async () => {
  await handler.pauseRecording()
})

resumeButton?.addEventListener('click', async () => {
  await handler.resumeRecording()
})

stopButton?.addEventListener('click', async () => {
  const audioURL = await handler.stopRecording()
  audioElement.src = audioURL

  //   startButton && startButton.disabled = false;
  //   stopButton && stopButton.disabled = true;
  //   playButton && playButton.disabled = false;
})

playButton?.addEventListener('click', () => {
  audioElement.play()
})
