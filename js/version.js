// The version baked into whatever JS bundle is currently running — compared
// against the live /version.json on every app open (see updateCheck.js) to
// detect a new deploy the service worker hasn't picked up yet.
//
// Bump this alongside version.json's "v" field and sw.js's CACHE_VERSION on
// every deploy. See the reminder comment at the top of sw.js.
export const APP_VERSION = "2.5.1";
