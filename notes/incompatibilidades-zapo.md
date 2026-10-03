# Incompatibilidades e decisões pendentes do Zapo

Este arquivo registra diferenças confirmadas. Nenhum item pode ser considerado compatível sem teste automatizado e, quando necessário, teste real controlado.

## Rejeição ativa de chamadas

O Zapo 1.9.0 publica eventos de chamada, mas sua API pública não expõe uma operação equivalente ao `rejectCall` usado pelo Baileys. Portanto:

- o webhook de chamada e a mensagem automática podem ser preservados;
- a rejeição ativa da ligação ainda não tem paridade comprovada;
- não será usado protocolo interno ou não documentado sem validação no código oficial e teste específico.

## Migração de credenciais Baileys → Zapo

O pacote `wa-store-migrate` 0.1.1 declara dependência em `zapo-js` da série 0.x, enquanto esta migração fixa `zapo-js` 1.9.0. A ferramenta não será aplicada sobre sessões de produção antes de um teste de compatibilidade isolado e reversível.

## Ciclo de conexão

`WaClient.connect()` permanece pendente enquanto uma sessão nova aguarda pareamento. A adaptação da UnoAPI deve iniciar a conexão sem bloquear a resposta HTTP que entrega o QR Code. O Zapo também não reconecta automaticamente; o ciclo de retentativa precisa continuar sob controle da UnoAPI.

## Ambiente local

- O Docker ainda não está disponível nesta máquina.
- O repositório exige Node.js 24 ou superior; o host atual possui Node.js 22.
- A instalação de dependências foi interrompida após repetidas falhas de rede, sem gerar `node_modules` nem alterar o lockfile.
