# Plano de Conversão da UnoAPI para Zapo
## Mantendo integralmente a arquitetura, contratos e comportamento externo da UnoAPI

> Objetivo: substituir **somente a camada Baileys/Whaileys da UnoAPI pelo Zapo**, mantendo o restante da UnoAPI no mesmo formato operacional.
>
> Não é uma reescrita da UnoAPI.  
> Não é uma nova API em volta do Zapo.  
> Não é uma alteração de arquitetura.
>
> A estratégia é transformar o Zapo no novo **driver/provedor interno de WhatsApp** da UnoAPI.

---

# 1. Objetivo técnico

A infraestrutura atual deve continuar existindo no mesmo formato:

```text
Traefik / Coolify
        |
        v
+---------------+
|      web      |
|   yarn web    |
|    :9876      |
+-------+-------+
        |
        | RabbitMQ / Redis
        |
+-------v-------+
|    broker     |
| yarn broker   |
+-------+-------+
        |
        |
+-------v-------+
|   bridge-1    |
| yarn bridge   |
+-------+-------+
        |
        | CAMADA A SUBSTITUIR
        v
+---------------+
| Whaileys /    |
| Baileys       |
+-------+-------+
        |
        v
    WhatsApp
```

A arquitetura desejada é:

```text
Traefik / Coolify
        |
        v
+---------------+
|      web      |
|   yarn web    |
|    :9876      |
+-------+-------+
        |
        | MESMO RabbitMQ / Redis
        |
+-------v-------+
|    broker     |
| yarn broker   |
+-------+-------+
        |
        |
+-------v-------+
|   bridge-1    |
| yarn bridge   |
+-------+-------+
        |
        | ÚNICA TROCA ESTRUTURAL
        v
+---------------+
|     Zapo      |
|   WaClient    |
+-------+-------+
        |
        v
    WhatsApp
```

A meta é que, olhando de fora:

```text
Antes = UnoAPI
Depois = UnoAPI
```

Nada externo deve precisar saber que o motor WhatsApp mudou.

---

# 2. Regra principal da migração

A conversão deve seguir esta regra:

```text
NÃO alterar:
- web
- broker
- endpoints
- payloads REST
- resposta dos endpoints
- webhook
- estrutura dos webhooks
- headers
- autenticação HTTP
- RabbitMQ
- Redis utilizado pela UnoAPI para configuração
- S3
- nomes dos serviços
- yarn web
- yarn broker
- yarn bridge
- porta 9876
- Traefik
- domínio
- variáveis de ambiente existentes
- comportamento do Coolify

ALTERAR:
- integração direta com baileys/whaileys
- criação do socket WhatsApp
- eventos do socket WhatsApp
- autenticação criptográfica da sessão
- armazenamento específico da sessão Baileys
- chamadas de envio que hoje dependem do socket Baileys
- utilitários estritamente dependentes do Baileys
```

---

# 3. A UnoAPI continua sendo a camada principal

A UnoAPI já possui toda a lógica que interessa manter:

```text
HTTP
|
|-- autenticação
|-- rotas
|-- Cloud API compatibility
|-- validação dos payloads
|-- templates
|-- transformação de mensagens
|-- webhook
|-- download/upload de mídia
|-- armazenamento S3
|-- Redis
|-- RabbitMQ
|-- gerenciamento dos bridges
|-- regras de ignore
|-- delays
|-- status de conexão
|-- Socket.IO / QR
|-- logs
|
v
WhatsApp Driver
```

A alteração deve acontecer somente no último nível:

```text
WhatsApp Driver
```

Hoje:

```text
UnoAPI
   |
   v
Whaileys/Baileys
```

Depois:

```text
UnoAPI
   |
   v
UnoWhatsAppAdapter
   |
   v
Zapo
```

---

# 4. Não substituir diretamente chamadas Baileys por Zapo em todo o projeto

Não é recomendado fazer:

```text
arquivo 1 -> trocar Baileys por Zapo
arquivo 2 -> trocar Baileys por Zapo
arquivo 3 -> trocar Baileys por Zapo
arquivo 4 -> trocar Baileys por Zapo
...
```

Isso espalharia conhecimento do Zapo pelo projeto inteiro.

A estratégia correta é criar uma camada interna de compatibilidade.

Exemplo:

```text
src/
  whatsapp/
    index.ts
    types.ts
    client.ts
    events.ts
    auth.ts
    media.ts
    jid.ts
    zapo/
      client.ts
      mapper.ts
      events.ts
      auth.ts
```

Ou, para minimizar ainda mais a alteração no projeto:

```text
src/
  baileys/
      compatibility.ts
      ...
```

mantendo temporariamente nomes internos antigos, porém implementados usando Zapo.

A opção mais limpa é:

```text
src/whatsapp/
```

---

# 5. Criar uma interface interna compatível com o que a UnoAPI realmente usa

Antes de trocar a engine, fazer um levantamento de todas as chamadas/importações relacionadas a:

```text
baileys
whaileys
makeWASocket
WASocket
AuthenticationState
DisconnectReason
proto
WAMessage
WAMessageKey
WAMessageContent
BaileysEventMap
downloadMediaMessage
jidNormalizedUser
jidDecode
generateWAMessage
generateWAMessageFromContent
prepareWAMessageMedia
Browsers
fetchLatestBaileysVersion
```

O objetivo não é implementar o Baileys inteiro.

O objetivo é implementar somente o subconjunto utilizado pela UnoAPI.

Criar algo conceitualmente assim:

```ts
interface UnoWhatsAppClient {
  connect(): Promise<void>
  disconnect(): Promise<void>

  sendMessage(jid: string, content: UnoMessageContent): Promise<UnoSentMessage>

  readMessages(keys: UnoMessageKey[]): Promise<void>

  sendPresenceUpdate(
    presence: UnoPresence,
    jid?: string
  ): Promise<void>

  profilePictureUrl(
    jid: string
  ): Promise<string | undefined>

  logout(): Promise<void>

  getConnectionState(): UnoConnectionState

  on(event: string, callback: Function): void
}
```

Toda a UnoAPI passa a falar com essa interface.

A implementação será:

```text
UnoWhatsAppClient
       |
       v
ZapoWhatsAppClient
       |
       v
WaClient
```

---

# 6. Princípio mais importante: preservar os objetos internos esperados pela UnoAPI

A melhor estratégia não é obrigar o restante da UnoAPI a entender os tipos do Zapo.

Deve ser o inverso.

```text
Zapo
 |
 v
Mapper
 |
 v
Formato interno que a UnoAPI já espera
```

Exemplo:

```text
Zapo Message Event
        |
        v
ZapoToUnoMessageMapper
        |
        v
estrutura equivalente à atualmente consumida
pela UnoAPI
```

O mesmo vale para:

```text
connection.update
messages.upsert
messages.update
contacts.update
presence.update
creds.update
groups.update
call
```

A camada Zapo precisa traduzir os eventos para o formato interno esperado pela UnoAPI.

---

# 7. Estratégia de compatibilidade de eventos

Hoje uma parte importante da UnoAPI provavelmente depende do EventEmitter do Baileys.

Conceitualmente:

```ts
socket.ev.on('connection.update', ...)
socket.ev.on('messages.upsert', ...)
socket.ev.on('messages.update', ...)
socket.ev.on('creds.update', ...)
```

Com Zapo, não alterar a lógica superior.

Criar um EventEmitter compatível:

```text
Zapo Events
    |
    v
ZapoEventAdapter
    |
    v
Uno/Baileys-like EventEmitter
    |
    v
código atual da UnoAPI
```

Exemplo conceitual:

```ts
zapo.on('message', event => {
  unoEvents.emit('messages.upsert', convertMessage(event))
})

zapo.on('auth_qr', event => {
  unoEvents.emit('connection.update', {
    qr: event.qr
  })
})

zapo.on('auth_paired', event => {
  // atualizar estado equivalente
})
```

O objetivo é reduzir alterações no restante do código.

---

# 8. QR Code deve continuar exatamente como hoje

Atualmente:

```text
GET /session/:phone
```

continua igual.

WebSocket:

```text
/ws
```

continua igual.

Evento:

```text
broadcast
```

continua igual.

Payload entregue para o frontend continua igual.

Internamente:

```text
Zapo
 |
 | auth_qr
 v
adapter
 |
 v
estrutura de QR da UnoAPI
 |
 +--> webhook existente
 |
 +--> Socket.IO existente
 |
 +--> /session/:phone existente
```

Nenhum cliente externo deve consumir diretamente o evento `auth_qr` do Zapo.

---

# 9. Conexão deve continuar controlada pelo bridge

O `bridge-1` deve continuar sendo o processo responsável pela conexão WhatsApp.

Não mover sessões para `web`.

Não mover sessões para `broker`.

Não criar um novo serviço `zapo`.

Deve continuar:

```yaml
bridge-1:
  image: ...
  entrypoint: 'yarn bridge'
  environment:
    UNOAPI_SERVER_NAME: server_1
```

O que muda é o conteúdo executado pelo bridge:

```text
src/bridge.ts
   |
   v
lógica atual UnoAPI
   |
   v
WhatsApp Adapter
   |
   v
Zapo WaClient
```

---

# 10. `web` permanece intacto

Idealmente:

```text
src/web.ts
```

não deve conhecer o Zapo.

Sua função continua sendo:

```text
HTTP
Cloud API format
Auth
WebSocket
Session page
RabbitMQ
Redis
API responses
```

O máximo de mudança aceitável no `web` seria algum import indireto de tipo/interface compartilhada.

Nenhuma lógica específica de `WaClient` deve aparecer no `web`.

---

# 11. `broker` permanece intacto

Idealmente:

```text
src/broker.ts
```

não muda.

O broker deve continuar trabalhando com:

```text
RabbitMQ
messages
routing
queues
bridge destination
```

Não deve existir:

```ts
import { WaClient } from 'zapo-js'
```

dentro do broker.

A arquitetura deve continuar:

```text
API
 |
 v
RabbitMQ
 |
 v
broker
 |
 v
bridge
 |
 v
Zapo
```

---

# 12. RabbitMQ deve continuar no mesmo formato

Não alterar:

```env
AMQP_URL=
```

Não alterar:

```text
exchange
routing keys
queue names
message envelopes
correlation IDs
reply queues
```

Se hoje o bridge recebe um objeto:

```json
{
  "session": "...",
  "action": "...",
  "payload": {}
}
```

o novo bridge deve continuar recebendo exatamente o mesmo objeto.

A conversão acontece somente depois que a mensagem chega ao bridge.

```text
RabbitMQ payload atual
        |
        v
bridge atual
        |
        v
UnoMessageMapper
        |
        v
Zapo
```

---

# 13. Redis da UnoAPI deve continuar com as mesmas chaves

Toda informação que não pertence especificamente ao estado criptográfico do Baileys deve permanecer no mesmo formato.

Exemplo:

```text
configurações da sessão
templates
status operacional
tokens
metadados
preferências
routing
```

Se hoje existem chaves como:

```text
unoapi-template:{PHONE}
unoapi-...
```

elas permanecem.

Não migrar desnecessariamente essas informações para o store nativo do Zapo.

---

# 14. Separar Redis funcional da UnoAPI do store do Zapo

Existem dois tipos diferentes de dados:

## Dados da UnoAPI

```text
config
templates
status
API state
routing
metadata
```

Continuam exatamente iguais.

## Dados internos da engine WhatsApp

Hoje:

```text
Baileys/Whaileys auth state
Signal keys
prekeys
sessions
sender keys
app state
identity
```

Esses devem passar a ser gerenciados pelo Zapo.

O Zapo oferece store Redis.

Portanto a arquitetura pode usar o mesmo servidor Redis, porém com namespace separado.

Exemplo:

```text
Redis
 |
 +-- unoapi:...
 |
 +-- unoapi-template:...
 |
 +-- zapo:session:...
 |
 +-- zapo:signal:...
 |
 +-- zapo:prekey:...
 |
 +-- zapo:identity:...
```

Importante:

**não alterar as chaves existentes da UnoAPI apenas para acomodar o Zapo.**

---

# 15. Session ID do Zapo deve ser derivado diretamente da sessão UnoAPI

Hoje a identidade principal parece ser o número:

```text
5549999999999
```

Então:

```text
UnoAPI phone/session
        =
Zapo sessionId
```

Exemplo:

```ts
new WaClient({
  store,
  sessionId: phoneNumber
})
```

Evitar criar identificadores paralelos como UUID, a menos que seja estritamente necessário.

Isso facilita:

```text
/session/:phone
Redis
logs
RabbitMQ
bridge
Zapo
```

todos apontarem para a mesma sessão lógica.

---

# 16. Camada de autenticação WhatsApp

A autenticação HTTP:

```env
UNOAPI_AUTH_TOKEN=
```

não muda.

Isso é completamente diferente da autenticação da sessão WhatsApp.

A mudança é somente:

```text
Baileys AuthenticationState
            |
            X
            |
            v
Zapo Store/Auth
```

A UnoAPI continua usando:

```env
UNOAPI_AUTH_TOKEN
```

para proteger endpoints exatamente como antes.

---

# 17. Migração de sessões existentes

Para não exigir QR novamente para todos os números, criar um módulo específico:

```text
UnoapiBaileysSessionMigrator
```

Fluxo:

```text
Estado atual da sessão UnoAPI/Whaileys
            |
            v
leitor do formato persistido
            |
            v
Baileys auth snapshot
            |
            v
wa-store-migrate
            |
            v
Zapo snapshot
            |
            v
Zapo store
```

Existe um projeto específico para migração entre Baileys e Zapo:

```text
wa-store-migrate
```

A estratégia deve ser:

```text
READ ONLY na origem
        |
        v
converter
        |
        v
validar
        |
        v
gravar destino
```

Nunca modificar a sessão original durante a primeira conversão.

---

# 18. Compatibilidade com `WHATSAPP_VERSION`

Hoje existe:

```env
WHATSAPP_VERSION=[2, 3000, 1048232398]
```

A variável deve continuar existindo inicialmente para não alterar o `.env`.

Porém internamente existem duas possibilidades:

## Opção A — Zapo permite configurar a versão

Mapear:

```text
WHATSAPP_VERSION
      |
      v
Zapo client version
```

## Opção B — Zapo gerencia a versão internamente

Manter a variável por compatibilidade, mas registrar no boot:

```text
WHATSAPP_VERSION presente, porém não utilizada pelo provider Zapo
```

Não remover a variável no primeiro ciclo da migração.

---

# 19. Mapeamento de envio

A entrada da API permanece exatamente igual.

Exemplo atual:

```http
POST /v15.0/:phone/messages
```

Payload:

```json
{
  "messaging_product": "whatsapp",
  "to": "5549999999999",
  "type": "text",
  "text": {
    "body": "Olá"
  }
}
```

Fluxo:

```text
HTTP atual
 |
 v
parser atual da UnoAPI
 |
 v
objeto interno atual
 |
 v
bridge
 |
 v
ZapoMessageAdapter
 |
 v
client.message.send(...)
```

O endpoint não precisa saber como o Zapo envia.

---

# 20. Criar `ZapoMessageAdapter`

Ele deve receber os tipos internos atuais e chamar os recursos correspondentes do Zapo.

Exemplo:

```text
UnoAPI text
   -> Zapo text

UnoAPI image
   -> Zapo image

UnoAPI audio
   -> Zapo audio/PTT

UnoAPI video
   -> Zapo video

UnoAPI document
   -> Zapo document

UnoAPI contact
   -> Zapo contact

UnoAPI location
   -> Zapo location

UnoAPI reaction
   -> Zapo reaction

UnoAPI reply/context
   -> Zapo quoted/reply

UnoAPI read
   -> Zapo read receipt

UnoAPI presence
   -> Zapo presence
```

Cada conversor deve ser isolado.

Exemplo:

```text
src/whatsapp/zapo/messages/
  text.ts
  image.ts
  audio.ts
  video.ts
  document.ts
  contact.ts
  location.ts
  reaction.ts
  interactive.ts
  read.ts
```

---

# 21. Não alterar os transformers Cloud API existentes

A UnoAPI já transforma:

```text
Cloud API payload
      |
      v
formato que a engine entende
```

Não reescrever esse parser para Zapo.

Colocar o Zapo depois dele.

Errado:

```text
Cloud API -> Zapo diretamente
```

Correto:

```text
Cloud API
   |
   v
UnoAPI parser atual
   |
   v
estrutura interna UnoAPI
   |
   v
adapter
   |
   v
Zapo
```

Isso preserva o comportamento atual.

---

# 22. Recebimento de mensagens

O processo inverso deve seguir a mesma lógica.

```text
WhatsApp
   |
   v
Zapo
   |
   v
ZapoInboundAdapter
   |
   v
objeto interno equivalente ao usado hoje
   |
   v
processamento atual da UnoAPI
   |
   v
webhook atual
```

A parte que gera o webhook **não deve ser reescrita**.

---

# 23. Webhook deve continuar byte/logicamente compatível

Manter:

```env
WEBHOOK_URL=
WEBHOOK_HEADER=
WEBHOOK_TOKEN=
WEBHOOK_SEND_NEW_MESSAGES=
WEBHOOK_SEND_OUTGOING_MESSAGES=
WEBHOOK_SEND_GROUP_MESSAGES=
```

O objetivo é que para a mesma mensagem:

```text
Baileys atual -> webhook X

Zapo novo -> webhook X
```

com o máximo de equivalência possível em:

```text
estrutura
campos
tipos
message_id
from
timestamp
contacts
messages
statuses
context
media metadata
```

Esse deve ser um dos principais testes de regressão.

---

# 24. Criar testes de snapshot de webhook

Antes de trocar a engine, capturar payloads reais gerados pela UnoAPI atual.

Exemplo:

```text
fixtures/webhooks/
  incoming-text.json
  incoming-image.json
  incoming-audio.json
  incoming-document.json
  incoming-reply.json
  incoming-reaction.json
  outgoing-status.json
  connection-status.json
  qrcode.json
```

Depois alimentar eventos equivalentes pelo adapter Zapo.

Teste:

```ts
expect(zapoGeneratedWebhook).toEqual(
  existingUnoApiWebhookFixture
)
```

Quando algum campo for impossível de manter exatamente igual, documentar explicitamente.

---

# 25. IDs de mensagem

Esse ponto merece atenção especial.

Não criar IDs artificiais se o Zapo expuser o ID real do WhatsApp.

A camada deve garantir que:

```text
send response
webhook
reply
reaction
read receipt
media lookup
```

usem o mesmo identificador lógico.

Criar funções centralizadas:

```text
toUnoMessageId()
fromUnoMessageId()
```

Somente se existir diferença real de representação.

---

# 26. JID / LID / grupos

Centralizar toda conversão de identificadores.

Criar:

```text
src/whatsapp/zapo/jid.ts
```

Funções:

```text
normalizeUserJid()
normalizeGroupJid()
normalizeLid()
phoneToJid()
jidToPhone()
isGroup()
isBroadcast()
isStatus()
```

O restante da UnoAPI continua consumindo os formatos atuais.

O adapter absorve eventuais diferenças entre Zapo e Baileys.

---

# 27. IGNORE_* deve continuar na UnoAPI

Variáveis:

```env
IGNORE_GROUP_MESSAGES=
IGNORE_BROADCAST_STATUSES=
IGNORE_BROADCAST_MESSAGES=
IGNORE_HISTORY_MESSAGES=
IGNORE_OWN_MESSAGES=
IGNORE_YOURSELF_MESSAGES=
IGNORE_DATA_STORE=
```

Devem continuar significando a mesma coisa.

Preferencialmente aplicar os filtros na mesma camada atual da UnoAPI.

Não mover a regra de negócio para dentro do Zapo sem necessidade.

Fluxo ideal:

```text
Zapo event
    |
    v
adapter
    |
    v
evento UnoAPI
    |
    v
filtros atuais IGNORE_*
```

---

# 28. Delays permanecem controlados pela UnoAPI

Variáveis atuais:

```env
UNOAPI_DELAY_AFTER_FIRST_MESSAGE_WEBHOOK_MS=
UNOAPI_DELAY_AFTER_FIRST_MESSAGE_MS=
UNOAPI_DELAY_BETWEEN_MESSAGES_MS=
UNOAPI_RETRY_REQUEST_DELAY_MS=
```

Continuam válidas.

Não substituir automaticamente esses delays pelos mecanismos internos do Zapo.

O comportamento observável precisa continuar o mesmo.

---

# 29. `SEND_AUDIO_MESSAGE_AS_PTT`

Manter:

```env
SEND_AUDIO_MESSAGE_AS_PTT=true
```

Fluxo:

```text
UnoAPI recebe audio
     |
     v
regra existente
     |
     | SEND_AUDIO_MESSAGE_AS_PTT
     v
ZapoMessageAdapter
     |
     v
voice note/PTT correspondente no Zapo
```

Se o Zapo exigir metadados adicionais de áudio, encapsular dentro do adapter.

O Zapo possui pacote de utilidades de mídia que pode auxiliar em waveform/voice-note quando necessário.

---

# 30. S3 permanece exatamente como está

Não migrar armazenamento de mídia para o Zapo.

Continuar usando:

```env
STORAGE_ENDPOINT=
STORAGE_REGION=
STORAGE_BUCKET_NAME=
STORAGE_ACCESS_KEY_ID=
STORAGE_SECRET_ACCESS_KEY=
STORAGE_FORCE_PATH_STYLE=
```

Fluxo:

```text
Zapo recebe mídia
       |
       v
adapter obtém/decripta mídia
       |
       v
pipeline atual UnoAPI
       |
       v
S3 atual
       |
       v
webhook atual
```

Para envio:

```text
URL / S3 / Buffer
       |
       v
pipeline atual UnoAPI
       |
       v
Zapo adapter
```

---

# 31. Profile Picture

Manter:

```env
SEND_PROFILE_PICTURE=true
```

A lógica superior continua igual.

Somente substituir a operação:

```text
Baileys profilePictureUrl
```

por:

```text
Zapo profile/business/contact API equivalente
```

através do adapter.

---

# 32. Status de conexão

Manter:

```env
SEND_CONNECTION_STATUS=true
```

Criar uma máquina de estados de compatibilidade.

Exemplo interno:

```text
Zapo connecting
   -> UnoAPI connecting

Zapo QR
   -> UnoAPI qrcode

Zapo paired
   -> UnoAPI connected/authenticated

Zapo ready
   -> UnoAPI open

Zapo disconnected
   -> UnoAPI close/disconnected
```

O webhook externo precisa continuar recebendo os mesmos tipos usados hoje.

---

# 33. Disconnect Reason

Baileys possui sua própria enumeração/motivos de desconexão.

Zapo poderá usar outro modelo.

Criar:

```text
ZapoDisconnectReasonMapper
```

Saída:

```text
motivos reconhecidos pela UnoAPI
```

Exemplos conceituais:

```text
loggedOut
connectionClosed
connectionLost
connectionReplaced
restartRequired
timedOut
badSession
unknown
```

O restante da UnoAPI não deve conhecer códigos específicos do Zapo.

---

# 34. Auto connect

Manter:

```env
AUTO_CONNECT=true
```

A inicialização do bridge continua:

```text
bridge start
   |
   v
descobrir sessões
   |
   v
AUTO_CONNECT?
   |
   v
create client
   |
   v
connect
```

A única mudança:

```text
create client
```

passa a retornar o wrapper Zapo.

---

# 35. Timeout e QR timeout

Manter:

```env
CONNECTING_TIMEOUT_MS=
UNOAPI_SESSION_TIMEOUT_MS=
QR_TIMEOUT_MS=
```

Mesmo que o Zapo tenha seus próprios timeouts.

Criar a regra:

```text
timeout UnoAPI
sempre governa o comportamento externo.
```

Configurações internas do Zapo devem ser adaptadas para respeitar esse contrato.

---

# 36. `CONFIG_SESSION_PHONE_CLIENT`

Manter:

```env
CONFIG_SESSION_PHONE_CLIENT=Papo AI
```

Se atualmente isso é usado na identificação do dispositivo durante pairing, mapear para os dados equivalentes de client/device no Zapo.

Se a semântica do Zapo diferir, criar tradução dentro da configuração do adapter.

---

# 37. `CONNECTION_TYPE=qrcode`

Manter:

```env
CONNECTION_TYPE=qrcode
```

O bridge continua escolhendo o método de conexão conforme a UnoAPI.

O Zapo apenas fornece a implementação final.

No futuro pode ser acrescentado pairing code, mas isso não deve fazer parte da primeira migração se não for necessário.

---

# 38. Templates continuam sendo UnoAPI

Manter integralmente:

```text
/v15.0/:phone/templates
Redis unoapi-template:{PHONE}
ONLY_HELLO_TEMPLATE
```

Templates pertencem à camada UnoAPI.

Não devem ser transferidos para Zapo.

---

# 39. Estrutura Docker

O objetivo é preservar inclusive a experiência de deploy.

Continuar:

```yaml
services:

  web:
    image: 'SEU-FORK-UNOAPI-ZAPO:VERSION'
    restart: always
    entrypoint: 'yarn web'
    ports:
      - '9876:9876'
    env_file:
      - .env

  broker:
    image: 'SEU-FORK-UNOAPI-ZAPO:VERSION'
    restart: always
    entrypoint: 'yarn broker'
    env_file:
      - .env

  bridge-1:
    image: 'SEU-FORK-UNOAPI-ZAPO:VERSION'
    restart: always
    entrypoint: 'yarn bridge'
    environment:
      UNOAPI_SERVER_NAME: server_1
    env_file:
      - .env
```

A principal mudança é a imagem:

```text
clairton/unoapi-cloud:2.11.7

->

registry.papoai/.../unoapi-zapo:<versão>
```

Todo o resto deve permanecer o mais igual possível.

---

# 40. Não criar container separado para Zapo

Evitar:

```text
web
broker
bridge
zapo
```

Não é necessário.

Zapo é uma biblioteca.

Ele deve estar dentro da imagem da UnoAPI modificada.

Correto:

```text
unoapi-zapo image
 |
 +-- yarn web
 |
 +-- yarn broker
 |
 +-- yarn bridge
       |
       +-- zapo-js
```

---

# 41. `package.json`

Hoje a UnoAPI possui dependência semelhante a:

```json
"baileys": "npm:whaileys@..."
```

A primeira etapa não precisa remover imediatamente a dependência.

Adicionar:

```text
zapo-js
@zapo-js/store-redis
```

e, se necessário:

```text
@zapo-js/media-utils
```

Durante a migração:

```text
Baileys + Zapo
```

podem coexistir no `package.json`.

Após todos os caminhos Baileys deixarem de ser usados e os testes passarem:

```text
remover baileys/whaileys
```

Isso facilita compilação incremental e comparação.

---

# 42. Estratégia Provider

Recomendo criar uma configuração temporária:

```env
WHATSAPP_PROVIDER=zapo
```

Mesmo que o objetivo final seja remover Baileys completamente.

Isso permite:

```text
WHATSAPP_PROVIDER=baileys
```

ou:

```text
WHATSAPP_PROVIDER=zapo
```

na mesma imagem durante homologação.

Arquitetura:

```text
createWhatsAppClient()
        |
        +-- baileys -> cliente atual
        |
        +-- zapo    -> ZapoWhatsAppClient
```

Isso dá rollback instantâneo.

Depois de estabilizado:

```text
remover provider baileys
remover variável WHATSAPP_PROVIDER
Zapo vira default único
```

---

# 43. Esta é a melhor estratégia para reduzir risco

Em vez de:

```text
commit gigante:
"substituir baileys por zapo"
```

fazer:

```text
Commit 1
Criar interface WhatsAppProvider sem alterar comportamento.

Commit 2
Mover criação atual Baileys para BaileysProvider.

Commit 3
Mover eventos atuais para contrato comum.

Commit 4
Mover envio atual para contrato comum.

Commit 5
Adicionar ZapoProvider.

Commit 6
Implementar auth/store Zapo.

Commit 7
Implementar eventos Zapo.

Commit 8
Implementar envio Zapo.

Commit 9
Implementar mídia.

Commit 10
Implementar QR/status.

Commit 11
Ativar Zapo em sessão teste.

Commit 12
Adicionar migrador de sessão.

Commit 13
Ativar Zapo gradualmente.

Commit 14
Remover código Baileys.
```

---

# 44. Estrutura de arquivos sugerida

Sem alterar desnecessariamente o restante:

```text
src/
|
|-- web.ts
|-- broker.ts
|-- bridge.ts
|
|-- ... todo o código atual UnoAPI ...
|
`-- whatsapp/
    |
    |-- provider.ts
    |-- types.ts
    |-- events.ts
    |-- messages.ts
    |-- session.ts
    |
    |-- baileys/
    |   |-- provider.ts
    |   `-- ...
    |
    `-- zapo/
        |-- provider.ts
        |-- client.ts
        |-- store.ts
        |-- auth.ts
        |-- events.ts
        |-- messages.ts
        |-- media.ts
        |-- jid.ts
        |-- disconnect.ts
        `-- mapper.ts
```

Durante a transição:

```text
baileys/
zapo/
```

Depois:

```text
zapo/
```

apenas.

---

# 45. Contrato interno

Exemplo conceitual:

```ts
export interface WhatsAppProvider {
  createSession(options: {
    sessionId: string
    phone: string
  }): Promise<WhatsAppSession>
}

export interface WhatsAppSession {
  connect(): Promise<void>
  logout(): Promise<void>
  close(): Promise<void>

  sendMessage(
    jid: string,
    content: unknown,
    options?: unknown
  ): Promise<unknown>

  readMessages(keys: unknown[]): Promise<void>

  sendPresenceUpdate(
    type: string,
    jid?: string
  ): Promise<void>

  getProfilePicture(
    jid: string
  ): Promise<string | undefined>

  events: EventEmitter
}
```

Não precisa ser exatamente esse contrato.

Ele deve ser criado após inventariar o que a UnoAPI realmente utiliza.

---

# 46. Ordem correta do desenvolvimento

## Etapa 1 — congelar comportamento atual

Criar testes de regressão antes da troca.

Capturar:

```text
endpoint -> resposta
evento -> webhook
mensagem -> RabbitMQ
RabbitMQ -> bridge
bridge -> envio
QR -> websocket
QR -> webhook
connection status -> webhook
mídia -> S3
```

---

## Etapa 2 — inventário Baileys

Executar no source da UnoAPI:

```bash
grep -R "from 'baileys'" -n src
grep -R 'from "baileys"' -n src
grep -R "whaileys" -n src
grep -R "makeWASocket" -n src
grep -R "WASocket" -n src
grep -R "\.ev\." -n src
grep -R "sendMessage" -n src
grep -R "downloadMedia" -n src
```

Gerar uma lista:

```text
Baileys dependency matrix
```

Exemplo:

| Arquivo | Dependência | Categoria | Substituição |
|---|---|---|---|
| X | makeWASocket | conexão | Zapo WaClient |
| X | messages.upsert | evento | adapter |
| Y | sendMessage | envio | adapter |
| Z | AuthenticationState | auth | Zapo store |
| W | downloadMediaMessage | mídia | Zapo/media adapter |

---

# 47. Etapa 3 — encapsular Baileys SEM Zapo

Esse passo é importante.

Primeiro fazer:

```text
UnoAPI -> interface -> Baileys
```

e provar que nada mudou.

Antes:

```text
UnoAPI -> Baileys
```

Depois:

```text
UnoAPI -> WhatsAppProvider -> Baileys
```

Os testes devem continuar 100% verdes.

Só depois:

```text
UnoAPI -> WhatsAppProvider -> Zapo
```

Isso separa refatoração de migração.

---

# 48. Etapa 4 — implementar ZapoProvider

Criar:

```text
ZapoProvider
```

Responsabilidades:

```text
createStore
create WaClient
sessionId
connect
disconnect
logout
QR
pair
messages
receipts
presence
contacts
groups
media
reconnect
status
```

Não colocar:

```text
HTTP
RabbitMQ
webhook
S3 business logic
Cloud API parsing
```

dentro dele.

---

# 49. Etapa 5 — Store Redis Zapo

Usar:

```text
@zapo-js/store-redis
```

Configurar para o mesmo Redis físico, caso desejado.

Mas criar prefixo exclusivo.

Exemplo conceitual:

```text
zapo:{server}:{session}:...
```

Onde:

```text
server = UNOAPI_SERVER_NAME
session = número
```

Exemplo:

```text
zapo:server_1:556299999999:...
```

Isso evita colisão em ambientes com múltiplos bridges.

---

# 50. Etapa 6 — adapter de eventos

Implementar primeiro:

```text
QR
connected
disconnected
message
message update/status
```

Depois:

```text
presence
contacts
groups
reactions
calls
history
```

Cada evento Zapo deve ser convertido antes de tocar no restante da UnoAPI.

---

# 51. Etapa 7 — adapter de envio

Prioridade:

```text
1. text
2. read
3. image
4. audio
5. PTT
6. document
7. video
8. reply
9. reaction
10. contact
11. location
12. interactive
13. demais recursos utilizados
```

Não implementar recursos que a sua instalação da UnoAPI não utiliza antes dos recursos críticos.

---

# 52. Etapa 8 — mídia

Validar:

```text
receber imagem
receber vídeo
receber áudio
receber documento

enviar imagem
enviar vídeo
enviar áudio
enviar documento

upload S3
download S3
mime type
filename
caption
PTT
```

A saída da UnoAPI precisa continuar a mesma.

---

# 53. Etapa 9 — migração de auth

Criar comando separado:

```bash
yarn migrate-session <phone>
```

Fluxo:

```text
verificar se sessão Zapo já existe
|
v
ler sessão UnoAPI/Baileys
|
v
converter
|
v
validar
|
v
escrever snapshot Zapo
|
v
NÃO conectar automaticamente
```

Depois:

```bash
yarn validate-session <phone>
```

E somente após validação:

```text
bridge Zapo connect
```

---

# 54. Etapa 10 — modo dual para homologação

Não conectar as duas engines simultaneamente na mesma sessão.

Mas permitir selecionar qual será usada:

```text
session A -> Baileys
session B -> Zapo
```

Exemplo de configuração temporária por sessão:

```text
unoapi-provider:{PHONE}=zapo
```

ou global:

```env
WHATSAPP_PROVIDER=zapo
```

Isso permite testar números diferentes no mesmo ambiente.

---

# 55. Nunca usar Baileys e Zapo simultaneamente na mesma sessão

Proibido:

```text
mesmo auth/device
 |
 +-- Baileys conectado
 |
 +-- Zapo conectado
```

Isso pode gerar:

```text
connection replaced
logout
conflitos de app state
sessão inválida
problemas de Signal state
```

Processo:

```text
STOP Baileys daquela sessão
|
v
snapshot
|
v
converter
|
v
START Zapo
```

---

# 56. Rollback

O rollback precisa continuar disponível até a migração terminar.

Por sessão:

```text
provider = baileys
```

ou:

```text
provider = zapo
```

Processo de rollback:

```text
stop Zapo session
|
v
garantir desconexão
|
v
reativar estado Baileys original
|
v
provider=baileys
|
v
bridge reconnect
```

Nunca sobrescrever o auth original da UnoAPI durante os primeiros ciclos.

---

# 57. Testes obrigatórios de equivalência

## Infraestrutura

- [ ] `yarn web` continua funcionando.
- [ ] `yarn broker` continua funcionando.
- [ ] `yarn bridge` continua funcionando.
- [ ] porta `9876` continua igual.
- [ ] Traefik continua igual.
- [ ] domínio continua igual.
- [ ] Coolify continua igual.
- [ ] RabbitMQ continua igual.
- [ ] Redis UnoAPI continua igual.
- [ ] S3 continua igual.

## API

- [ ] mesmos endpoints.
- [ ] mesmos headers.
- [ ] mesma autenticação.
- [ ] mesmos status HTTP.
- [ ] mesmos formatos JSON.
- [ ] mesmo endpoint de sessão.
- [ ] mesmo `/ws`.
- [ ] mesmas respostas de envio.

## WhatsApp

- [ ] QR Code.
- [ ] reconexão.
- [ ] logout.
- [ ] restart de container.
- [ ] persistência.
- [ ] texto.
- [ ] imagem.
- [ ] áudio.
- [ ] PTT.
- [ ] vídeo.
- [ ] documento.
- [ ] contato.
- [ ] localização.
- [ ] reply.
- [ ] reação.
- [ ] read.
- [ ] presence.
- [ ] grupo, se utilizado.
- [ ] LID.

## Webhook

- [ ] mensagem recebida.
- [ ] mensagem enviada.
- [ ] status.
- [ ] QR.
- [ ] connection status.
- [ ] mídia.
- [ ] reaction.
- [ ] reply/context.
- [ ] profile picture.

## Operação

- [ ] bridge reinicia sem perder sessão.
- [ ] Redis indisponível temporariamente.
- [ ] RabbitMQ indisponível temporariamente.
- [ ] S3 indisponível temporariamente.
- [ ] WhatsApp fecha socket.
- [ ] rede cai.
- [ ] conexão retorna.
- [ ] QR expira.
- [ ] sessão sofre logout remoto.

---

# 58. Critério de sucesso

A conversão está concluída somente quando um sistema externo não consegue identificar diferença entre:

```text
clairton/unoapi-cloud + Whaileys
```

e:

```text
fork UnoAPI + Zapo
```

considerando:

```text
HTTP
WebSocket
RabbitMQ
Redis funcional
Webhook
S3
payloads
status
timing
erros
session handling
```

A engine interna pode ser completamente diferente.

O contrato externo não.

---

# 59. Docker final esperado

A estrutura deve continuar conceitualmente igual à atual:

```yaml
services:

  web:
    image: 'registry/unoapi-zapo:<version>'
    restart: always
    entrypoint: 'yarn web'
    ports:
      - '9876:9876'
    labels:
      # mesmas labels atuais do Coolify/Traefik
    networks:
      current-network: null
    environment:
      # mesmas variáveis Coolify atuais
    env_file:
      - .env

  broker:
    image: 'registry/unoapi-zapo:<version>'
    restart: always
    entrypoint: 'yarn broker'
    labels:
      # mesmas labels
    networks:
      current-network: null
    environment:
      # mesmas variáveis
    env_file:
      - .env

  bridge-1:
    image: 'registry/unoapi-zapo:<version>'
    restart: always
    entrypoint: 'yarn bridge'
    environment:
      UNOAPI_SERVER_NAME: server_1
      # restantes variáveis continuam
    labels:
      # mesmas labels
    networks:
      current-network: null
    env_file:
      - .env
```

Não há motivo para mudar a topologia Docker apenas porque a biblioteca de WhatsApp mudou.

---

# 60. `.env` final

A primeira versão Zapo deve aceitar o mesmo `.env` atual.

Ou seja, todas as variáveis existentes permanecem aceitas.

Adicionar somente o mínimo necessário, preferencialmente:

```env
WHATSAPP_PROVIDER=zapo
```

e, se realmente necessário:

```env
ZAPO_REDIS_PREFIX=zapo
```

Não exigir que toda a infraestrutura altere nomes de variáveis para realizar a migração.

---

# 61. Resultado esperado no código

## Antes

```text
UnoAPI business/application code
        |
        +------ imports Baileys em vários lugares
        |
        v
Whaileys
```

## Etapa intermediária

```text
UnoAPI
   |
   v
WhatsAppProvider
   |
   +-----------+
   |           |
   v           v
Baileys      Zapo
```

## Final

```text
UnoAPI
   |
   v
WhatsAppProvider
   |
   v
Zapo
```

Todo o restante continua sendo UnoAPI.

---

# 62. Plano de execução objetivo

## Fase 1 — Inventário

1. Fazer fork da versão UnoAPI usada em produção.
2. Fixar uma branch baseada na versão correspondente ao deploy atual.
3. Localizar todos os imports/usos de Baileys/Whaileys.
4. Classificar cada uso:
   - conexão;
   - auth;
   - evento;
   - mensagem;
   - mídia;
   - JID;
   - grupos;
   - presence;
   - profile;
   - utilitário.
5. Criar testes/snapshots do comportamento atual.

## Fase 2 — Isolamento

6. Criar `WhatsAppProvider`.
7. Criar `BaileysProvider` encapsulando o código atual.
8. Redirecionar dependências diretas para a interface.
9. Rodar testes.
10. Confirmar que UnoAPI continua idêntica usando Baileys.

## Fase 3 — Zapo

11. Adicionar `zapo-js`.
12. Adicionar store Redis do Zapo.
13. Criar `ZapoProvider`.
14. Implementar `WaClient`.
15. Implementar QR.
16. Implementar conexão/reconexão.
17. Implementar mapper de eventos.
18. Implementar mapper de mensagens.
19. Implementar JID/LID.
20. Implementar status/read/presence.
21. Implementar mídia.
22. Implementar profile picture.
23. Implementar funcionalidades adicionais usadas pela UnoAPI.

## Fase 4 — Compatibilidade

24. Comparar API response Baileys vs Zapo.
25. Comparar webhooks.
26. Comparar RabbitMQ.
27. Comparar QR/WebSocket.
28. Comparar mídia/S3.
29. Comparar conexão/status.
30. Corrigir divergências no adapter, não no restante da UnoAPI.

## Fase 5 — Sessões

31. Implementar leitura do auth state atual.
32. Integrar `wa-store-migrate`.
33. Converter sessão teste.
34. Conectar somente via Zapo.
35. Reiniciar bridge.
36. Confirmar persistência sem QR.
37. Testar logout/reconnect.

## Fase 6 — Canary

38. Ativar Zapo em um número.
39. Depois em pequeno grupo.
40. Observar erros e webhooks.
41. Expandir gradualmente.
42. Manter rollback Baileys disponível.

## Fase 7 — Limpeza

43. Migrar todas as sessões.
44. Congelar Baileys.
45. Remover dependência Whaileys/Baileys.
46. Remover `BaileysProvider`.
47. Tornar Zapo provider definitivo.
48. Opcionalmente remover a flag `WHATSAPP_PROVIDER`.
49. Publicar imagem final.
50. Manter a arquitetura Docker exatamente no padrão UnoAPI.

---

# 63. Regra de desenvolvimento para evitar quebrar a UnoAPI

Toda vez que houver incompatibilidade:

```text
Zapo != Baileys
```

a correção deve acontecer preferencialmente em:

```text
src/whatsapp/zapo/*
```

e não em:

```text
web
broker
Cloud API parser
webhook
S3
rotas
RabbitMQ
```

Esse é o princípio que garante que o projeto continue sendo UnoAPI, apenas com uma engine diferente.

---

# 64. Resumo arquitetural

A implementação que deve ser perseguida é esta:

```text
                         INALTERADO
                             |
                             v
                    +----------------+
                    |    UnoAPI Web   |
                    |     :9876       |
                    +--------+-------+
                             |
                             v
                    +----------------+
                    |    RabbitMQ     |
                    +--------+-------+
                             |
                             v
                    +----------------+
                    | UnoAPI Broker   |
                    +--------+-------+
                             |
                             v
                    +----------------+
                    | UnoAPI Bridge   |
                    +--------+-------+
                             |
                 LIMITE DA ALTERAÇÃO
                             |
                             v
                 +----------------------+
                 | WhatsAppProvider     |
                 | Compatibility Layer  |
                 +----------+-----------+
                            |
                            v
                     +-------------+
                     |    Zapo     |
                     |  WaClient   |
                     +------+------+
                            |
                            v
                        WhatsApp
```

Em paralelo:

```text
UnoAPI config ----------> Redis atual
UnoAPI templates -------> Redis atual
UnoAPI queues ----------> RabbitMQ atual
UnoAPI media -----------> S3 atual
UnoAPI webhooks --------> endpoint atual

Zapo auth/signal -------> store Zapo
```

---

# 65. Conclusão

Para o seu caso, **não faz sentido converter UnoAPI em uma "Zapo API" independente**.

A melhor abordagem é:

```text
fork UnoAPI
+
preservar arquitetura inteira
+
criar uma abstração de WhatsApp
+
encapsular implementação atual Baileys
+
criar implementação equivalente usando Zapo
+
traduzir eventos/tipos Zapo para o contrato interno da UnoAPI
+
migrar auth Baileys -> Zapo
+
remover Baileys somente no final
```

Resultado final:

```text
web         = UnoAPI
broker      = UnoAPI
bridge      = UnoAPI
HTTP        = UnoAPI
webhook     = UnoAPI
RabbitMQ    = UnoAPI
Redis       = UnoAPI
S3          = UnoAPI
Docker      = UnoAPI
Coolify     = UnoAPI
Traefik     = UnoAPI

WhatsApp engine:
Whaileys/Baileys -> Zapo
```

Essa é a conversão de menor impacto e com maior compatibilidade possível.

---



# 66. Como iniciar o projeto na prática

Esta seção transforma o plano em um roteiro operacional. A ideia é você ter na mesma pasta:

```text
README.md
docker-compose.yml
.env
```

e começar pela UnoAPI original funcionando, antes de editar qualquer código.

A ordem correta é:

```text
UnoAPI original funcionando
→ capturar baseline
→ baixar o source
→ mapear Baileys/Whaileys
→ criar uma abstração
→ continuar usando Baileys por essa abstração
→ validar que nada mudou
→ adicionar Zapo
→ migrar recursos aos poucos
→ migrar sessões
→ canary
→ produção
→ remover Baileys
```

## 66.1 Estrutura inicial da pasta

Crie uma pasta exclusiva:

```bash
mkdir unoapi-zapo-migration
cd unoapi-zapo-migration
```

Estrutura sugerida:

```text
unoapi-zapo-migration/
├── README.md
├── docker-compose.original.yml
├── docker-compose.yml
├── .env.original
├── .env
├── source/
├── backups/
├── fixtures/
└── notes/
```

Crie as subpastas:

```bash
mkdir -p source backups fixtures notes
```

Mantenha sempre uma cópia intocada do stack e do `.env` atual:

```bash
cp docker-compose.yml docker-compose.original.yml
cp .env .env.original
```

## 66.2 Não comece editando Baileys

O primeiro objetivo é provar que a imagem atual:

```text
clairton/unoapi-cloud:2.11.7
```

funciona no ambiente de desenvolvimento exatamente como funciona hoje.

Antes de qualquer alteração:

```bash
docker compose pull
docker compose up -d
docker compose ps
```

Acompanhe:

```bash
docker compose logs -f web
```

```bash
docker compose logs -f broker
```

```bash
docker compose logs -f bridge-1
```

Esperado:

```text
web       running
broker    running
bridge-1  running
```

Não existe Zapo nessa etapa.

## 66.3 Use um ambiente de teste

Evite desenvolver diretamente no stack de produção. Use um servidor staging, VPS separada, Docker local ou VM separada. Se precisar expor o serviço, use outro domínio, por exemplo:

```text
zapo-test.papoai.com.br
```

ou somente:

```text
http://IP:9876
```

Não conecte a mesma sessão real simultaneamente em produção e no ambiente de teste. Para os primeiros testes, utilize um número separado.

## 66.4 Valide os serviços externos antes de mexer no código

Confirme conectividade com Redis, RabbitMQ, S3 e webhook.

Redis:

```bash
redis-cli -u "$REDIS_URL" ping
```

Esperado:

```text
PONG
```

RabbitMQ:

```bash
nc -vz HOST_RABBIT 5672
```

Storage:

```bash
curl -I https://SEU-STORAGE-ENDPOINT
```

O objetivo é garantir que, se algo quebrar depois, você saiba que a infraestrutura original estava saudável.

## 66.5 Crie o baseline da UnoAPI original

Antes de baixar o código-fonte, valide:

```text
[ ] web inicia
[ ] broker inicia
[ ] bridge inicia
[ ] API responde
[ ] Redis conecta
[ ] RabbitMQ conecta
[ ] storage conecta
[ ] QR é gerado
[ ] WhatsApp conecta
[ ] mensagem entra
[ ] mensagem sai
[ ] webhook chega
[ ] mídia é enviada
[ ] mídia é recebida
```

Se algo falhar aqui, não avance para Zapo ainda. Primeiro corrija o baseline.

## 66.6 Salve payloads reais antes da alteração

Crie:

```text
fixtures/
├── api/
├── webhooks/
├── rabbitmq/
├── session/
└── errors/
```

Salve exemplos de texto recebido, texto enviado, imagem, áudio/PTT, documento, reply, reaction, QR, connected, disconnected e erro de envio.

Esses arquivos serão a referência para comparar:

```text
UnoAPI + Baileys
```

contra:

```text
UnoAPI + Zapo
```

## 66.7 Só agora baixe o source

Entre em:

```bash
cd source
```

Clone o source correspondente à versão que você utiliza:

```bash
git clone <REPOSITORIO_UNOAPI> unoapi
cd unoapi
```

Crie uma branch exclusiva:

```bash
git checkout -b migration/zapo-provider
```

Confira:

```bash
git status
git log --oneline -10
git tag
```

Se houver uma tag correspondente à versão do container atual, baseie a branch nela.

## 66.8 A primeira análise no source

Antes de editar arquivos, localize tudo que depende de Baileys/Whaileys:

```bash
grep -R "whaileys" -n src .
grep -R "baileys" -n src .
grep -R "makeWASocket" -n src .
grep -R "WASocket" -n src .
grep -R "AuthenticationState" -n src .
grep -R "\.ev\.on" -n src .
grep -R "messages.upsert" -n src .
grep -R "connection.update" -n src .
grep -R "sendMessage" -n src .
grep -R "downloadMediaMessage" -n src .
```

Crie:

```text
notes/baileys-map.md
```

Exemplo:

```text
arquivo X
- cria socket
- connection.update
- QR

arquivo Y
- sendMessage

arquivo Z
- AuthenticationState

arquivo W
- downloadMediaMessage

arquivo K
- JID
```

Esse documento passa a ser o mapa da conversão.

## 66.9 Primeira edição real: criar o provider

Ainda não instale Zapo. Primeiro transforme:

```text
UnoAPI
  ↓
Baileys
```

em:

```text
UnoAPI
  ↓
WhatsAppProvider
  ↓
Baileys
```

A ideia é colocar o Baileys atual atrás de uma interface sem mudar comportamento.

Estrutura sugerida:

```text
src/
└── whatsapp/
    ├── provider.ts
    ├── types.ts
    └── baileys/
        ├── provider.ts
        ├── events.ts
        ├── messages.ts
        └── auth.ts
```

O código Baileys que já existe deve ser movido/encapsulado, não reescrito nessa etapa.

## 66.10 Primeiro milestone obrigatório

Antes de tocar em Zapo, você precisa chegar em:

```text
UnoAPI
  ↓
WhatsAppProvider
  ↓
Baileys original
```

e provar que web, broker, bridge, API, webhook, Redis, RabbitMQ e S3 continuam iguais.

## 66.11 Gere sua primeira imagem modificada

Depois de encapsular Baileys:

```bash
docker build -t unoapi-zapo-dev:0.1 .
```

No stack de desenvolvimento, troque apenas a imagem:

```yaml
image: unoapi-zapo-dev:0.1
```

para `web`, `broker` e `bridge-1`. Mantenha:

```yaml
entrypoint: 'yarn web'
entrypoint: 'yarn broker'
entrypoint: 'yarn bridge'
```

Suba novamente:

```bash
docker compose down
docker compose up -d --force-recreate
```

Rode toda a validação do baseline.

## 66.12 Só depois instale Zapo

Quando a abstração estiver estável:

```bash
yarn add zapo-js
yarn add @zapo-js/store-redis
```

Use os nomes e versões exatos exigidos pela versão do Zapo escolhida. Não remova Baileys ainda.

Agora:

```text
src/whatsapp/
├── provider.ts
├── baileys/
└── zapo/
```

Crie:

```text
src/whatsapp/zapo/provider.ts
src/whatsapp/zapo/client.ts
src/whatsapp/zapo/store.ts
src/whatsapp/zapo/events.ts
src/whatsapp/zapo/messages.ts
src/whatsapp/zapo/media.ts
src/whatsapp/zapo/jid.ts
```

## 66.13 Ordem de implementação do ZapoProvider

Implemente nesta ordem:

```text
1. Redis/store
2. sessionId
3. criação do WaClient
4. connect
5. QR
6. connected
7. disconnected
8. reconnect
9. texto recebido
10. texto enviado
11. read/status
12. reply
13. imagem
14. áudio/PTT
15. documento
16. vídeo
17. reação
18. presence
19. profile picture
20. grupos e demais recursos necessários
```

## 66.14 Provider temporário selecionável

Durante homologação, use:

```env
WHATSAPP_PROVIDER=baileys
```

ou:

```env
WHATSAPP_PROVIDER=zapo
```

Factory conceitual:

```text
createWhatsAppProvider()
        ├── baileys
        └── zapo
```

Isso é apenas uma chave interna temporária de rollback.

## 66.15 Primeiro teste Zapo deve usar QR novo

Não comece migrando auth antigo. Primeiro:

```text
provider=zapo
→ sessão vazia
→ gerar QR
→ parear número de teste
→ receber texto
→ enviar texto
→ reiniciar bridge
→ verificar reconexão sem novo QR
```

Se isso não estiver funcionando, não tente migrar sessão da UnoAPI ainda.

## 66.16 Fluxo de desenvolvimento de cada recurso

Para cada funcionalidade:

```text
1. execute com Baileys
2. capture response/webhook
3. execute com Zapo
4. compare
5. corrija no adapter
6. repita
```

Só passe para o próximo recurso quando o anterior estiver equivalente.

## 66.17 Onde não mexer no começo

Evite alterações em:

```text
web
broker
rotas HTTP
middlewares
auth HTTP
Cloud API parser
formatação do webhook
RabbitMQ payload
S3
Traefik
Coolify
```

Se o Zapo retornar algo diferente, adapte dentro de:

```text
src/whatsapp/zapo/*
```

## 66.18 Só depois migre auth existente

Crie algo como:

```bash
yarn migrate-session 556299999999
```

O comando deve:

```text
1. localizar auth Baileys/Whaileys
2. ler sem modificar
3. gerar snapshot
4. converter
5. validar
6. escrever no store Zapo
7. finalizar sem conectar
```

Depois:

```text
parar Baileys daquela sessão
→ iniciar Zapo
→ validar conexão
```

Nunca mantenha os dois conectados simultaneamente à mesma sessão.

## 66.19 Estrutura da pasta durante o desenvolvimento

```text
unoapi-zapo-migration/
├── README.md
├── docker-compose.original.yml
├── docker-compose.yml
├── .env.original
├── .env
├── source/
│   └── unoapi/
│       ├── src/
│       ├── package.json
│       ├── Dockerfile
│       └── ...
├── fixtures/
│   ├── api/
│   ├── webhooks/
│   ├── rabbitmq/
│   └── session/
├── backups/
│   └── sessions/
└── notes/
    ├── baileys-map.md
    ├── incompatibilities.md
    └── migration-log.md
```

## 66.20 Registre incompatibilidades

Crie `notes/incompatibilities.md` e registre diferenças de QR, connection, text, image, audio, document, reply, reaction, JID, LID, read, presence e profile.

## 66.21 Sequência completa do início

```text
PASSO 01  Criar pasta do projeto.
PASSO 02  Salvar README, stack e env.
PASSO 03  Criar cópias de desenvolvimento.
PASSO 04  Subir a UnoAPI oficial via Docker.
PASSO 05  Validar web, broker e bridge.
PASSO 06  Usar número de teste.
PASSO 07  Capturar fixtures de API e webhook.
PASSO 08  Baixar source da mesma versão.
PASSO 09  Criar branch de migração.
PASSO 10  Mapear Baileys/Whaileys.
PASSO 11  Criar WhatsAppProvider.
PASSO 12  Encapsular Baileys atual.
PASSO 13  Buildar a imagem modificada.
PASSO 14  Subir a imagem ainda usando Baileys.
PASSO 15  Comparar com o baseline.
PASSO 16  Instalar Zapo.
PASSO 17  Criar ZapoProvider.
PASSO 18  Implementar store + conexão + QR.
PASSO 19  Parear número de teste.
PASSO 20  Validar restart/reconnect.
PASSO 21  Implementar texto inbound/outbound.
PASSO 22  Comparar webhooks.
PASSO 23  Implementar mídia.
PASSO 24  Implementar demais eventos.
PASSO 25  Rodar regressão completa.
PASSO 26  Implementar migrador de auth.
PASSO 27  Migrar uma sessão real.
PASSO 28  Canary.
PASSO 29  Migração gradual.
PASSO 30  Remover Baileys somente no final.
```

## 66.22 Se você abrir o projeto amanhã, comece exatamente assim

```bash
# subir a UnoAPI original
docker compose up -d

# confirmar serviços
docker compose ps

# acompanhar o bridge
docker compose logs -f bridge-1

# depois de validar o baseline:
cd source/unoapi

# mapear dependências
grep -R "whaileys" -n src .
grep -R "baileys" -n src .
grep -R "makeWASocket" -n src .
grep -R "\.ev\.on" -n src .

# criar notes/baileys-map.md
# criar src/whatsapp/provider.ts
# criar src/whatsapp/baileys/
# encapsular o Baileys atual
# buildar e validar novamente

# SOMENTE DEPOIS:
# instalar Zapo
# criar src/whatsapp/zapo/
```

## 66.23 Primeiro objetivo real do desenvolvimento

Não use como primeira meta:

```text
Zapo precisa enviar mensagem.
```

Use:

```text
A UnoAPI precisa continuar funcionando exatamente igual depois que
Baileys for colocado atrás de uma interface.
```

Depois:

```text
Zapo precisa cumprir essa mesma interface.
```

## 66.24 Pontos seguros de commit

Depois de encapsular Baileys:

```bash
git add .
git commit -m "refactor: isolate whatsapp provider"
git tag pre-zapo-provider
```

Depois de Zapo funcionar com QR, connect, reconnect e texto:

```bash
git add .
git commit -m "feat: initial zapo provider"
git tag zapo-text-working
```

Depois de mídia + webhook + status:

```bash
git tag zapo-core-compatible
```

Somente depois comece a migração de sessões existentes.

## 66.25 Critério para tocar produção

```text
[ ] baseline salvo
[ ] abstração testada
[ ] Zapo QR funcionando
[ ] reconnect funcionando
[ ] texto inbound/outbound
[ ] mídia
[ ] webhook equivalente
[ ] RabbitMQ equivalente
[ ] S3 equivalente
[ ] status equivalente
[ ] persistência de auth
[ ] canary real
[ ] rollback Baileys testado
```

## 66.26 Regra final para decidir onde editar

```text
Isso é regra da UnoAPI?
→ não mexer.

Isso existe apenas por causa do Baileys?
→ provider/adapter.

Zapo retorna diferente?
→ converter no adapter.

O sistema externo percebeu a troca?
→ compatibilidade ainda não está pronta.
```

## 66.27 Ordem resumida

```text
Docker original
→ baseline
→ source
→ mapear Baileys
→ encapsular Baileys
→ validar
→ adicionar Zapo
→ QR/conexão
→ mensagens
→ mídia
→ webhook
→ auth migration
→ canary
→ produção
→ remover Baileys
```


# Referências técnicas

- UnoAPI Cloud: https://github.com/clairton/unoapi-cloud
- Zapo: https://github.com/vinikjkkj/zapo
- Documentação Zapo: https://zapo.to/en/introduction
- Migração de stores Baileys/Zapo: https://github.com/vinikjkkj/wa-store-migrate

---

## Observação de segurança

O `.env` utilizado como referência contém credenciais reais de infraestrutura. Este documento deliberadamente utiliza apenas **nomes das variáveis**, sem reproduzir tokens, senhas ou chaves.

Como essas credenciais foram compartilhadas fora do servidor de origem, é recomendável rotacionar posteriormente:

```text
UNOAPI_AUTH_TOKEN
WEBHOOK_TOKEN
credenciais AMQP
senha Redis
STORAGE_ACCESS_KEY_ID
STORAGE_SECRET_ACCESS_KEY
```
