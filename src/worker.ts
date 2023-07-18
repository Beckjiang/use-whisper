// worker.ts
/// <reference lib="webworker" />

interface WorkerCommands {
  command: string
  data: ArrayBuffer
}

import lamejs from 'lamejs'

let encoder: lamejs.Encoder | null = null

onmessage = (event: MessageEvent) => {
  const data = event.data as WorkerCommands
  let buffer: ArrayBuffer
  let mp3: Int8Array | undefined
  console.log('in worker data', data)

  switch (data.command) {
    case 'init':
      encoder = new lamejs.Mp3Encoder(1, 44100, 96)
      break
    case 'encode':
      if (!encoder) {
        encoder = new lamejs.Mp3Encoder(1, 44100, 96)
      }
      buffer = data.data
      console.log('in worker buffer', buffer)
      mp3 = encoder?.encodeBuffer(new Int16Array(buffer))
      self.postMessage(mp3)
      break
    case 'finish':
      console.log('test')
  }
}
