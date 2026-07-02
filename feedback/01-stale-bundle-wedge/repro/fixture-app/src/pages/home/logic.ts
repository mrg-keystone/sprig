// A logic.ts makes the page an island → the rendered HTML references client.js
// and hydration config, which is where the ?v= cache-bust shows up.
export default class Home {
  msg = "(server)";
  onServerInit() { this.msg = "hello from ssr"; }
}
