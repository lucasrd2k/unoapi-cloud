import { ListenerBaileys } from './listener_baileys'

// Os eventos Zapo são normalizados antes de chegar aqui. A herança mantém
// exatamente o pipeline de IDs, mídia, metadados e webhooks já validado pela UnoAPI.
export class ListenerZapo extends ListenerBaileys {}
