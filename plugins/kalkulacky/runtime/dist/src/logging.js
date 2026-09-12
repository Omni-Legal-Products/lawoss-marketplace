// Server dosiaľ nelogoval nič okrem štartovacej hlášky. Keď prestal odpovedať,
// v logoch nebolo po požiadavkách ani stopy — diagnostika sa musela robiť
// obchádzkou cez tools/list a token store. Toto je minimum, ktoré taký prípad
// urobí čitateľným.
const defaultSink = (event) => {
    // stderr, nie stdout: stdio transport posiela protokol po stdout.
    console.error(JSON.stringify(event));
};
let sink = defaultSink;
/** Testy si podstrčia vlastný sink; produkcia používa stderr. */
export function setLogSink(next) {
    sink = next ?? defaultSink;
}
export function logToolCall(event) {
    sink(event);
}
//# sourceMappingURL=logging.js.map