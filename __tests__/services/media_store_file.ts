import { DataStore } from '../../src/services/data_store'
import { getDataStore } from '../../src/services/data_store'
import { mock } from 'jest-mock-extended'
import { getMediaStoreFile, rehydrateZapoMediaFields } from '../../src/services/media_store_file'
import { MediaStore } from '../../src/services/media_store'
import { defaultConfig } from '../../src/services/config'
const phone = `${new Date().getTime()}`
const messageId = `wa.${new Date().getTime()}`
const url = `http://somehost`
const mimetype = 'text/plain'
const extension = 'txt'

const message = {
  messaging_product: 'whatsapp',
  id: `${phone}/${messageId}`,
  mime_type: mimetype,
}
const dataStore = mock<DataStore>()
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const getTestDataStore: getDataStore = async (_phone: string, _config: unknown): Promise<DataStore> => {
  return dataStore
}

describe('media routes', () => {
  let mediaStore: MediaStore

  beforeEach(() => {
    dataStore.loadMediaPayload.mockReturnValue(new Promise((resolve) => resolve(message)))
    mediaStore = getMediaStoreFile(phone, defaultConfig, getTestDataStore)
  })

  test('getMedia', async () => {
    const response = {
      url: `${url}/v15.0/download/${phone}/${messageId}.${extension}`,
      ...message,
    }
    expect(await mediaStore.getMedia(url, messageId)).toStrictEqual(response)
  })
})

describe('rehydrateZapoMediaFields', () => {
  test.each(['sticker', 'audio'])('restaura os campos protobuf de uma mídia %s serializada pelo RabbitMQ', (_type) => {
    const fields = {
      mediaKey: { 0: 10, 1: 20, 2: 30 },
      fileSha256: { type: 'Buffer', data: [40, 50, 60] },
      fileEncSha256: [70, 80, 90],
      fileLength: { low: 8434, high: 0, unsigned: true },
    }

    expect(rehydrateZapoMediaFields(fields)).toBe(fields)
    expect(fields.mediaKey).toBeInstanceOf(Uint8Array)
    expect(Array.from(fields.mediaKey as Uint8Array)).toEqual([10, 20, 30])
    expect(fields.fileSha256).toBeInstanceOf(Uint8Array)
    expect(Array.from(fields.fileSha256 as Uint8Array)).toEqual([40, 50, 60])
    expect(fields.fileEncSha256).toBeInstanceOf(Uint8Array)
    expect(Array.from(fields.fileEncSha256 as Uint8Array)).toEqual([70, 80, 90])
    expect(fields.fileLength).toBe(8434)
  })

  test('restaura um tamanho maior que 32 bits sem perder precisão', () => {
    const fields = {
      fileLength: { low: 5, high: 1, unsigned: true },
    }

    rehydrateZapoMediaFields(fields)

    expect(fields.fileLength).toBe(4294967301)
  })

  test('rejeita um campo binário inválido com mensagem em português', () => {
    expect(() => rehydrateZapoMediaFields({ mediaKey: { low: 1, high: 0 } })).toThrow(
      'O campo mediaKey da mídia Zapo possui um formato binário inválido.',
    )
  })
})
