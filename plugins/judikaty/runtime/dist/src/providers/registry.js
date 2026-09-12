import { JusticeProvider } from "./justice/provider.js";
import { NsudProvider } from "./nsud/provider.js";
import { UstavnyProvider } from "./ustavny/provider.js";
export class InMemoryProviderRegistry {
    #providers = new Map();
    register(provider) {
        this.#providers.set(provider.id, provider);
    }
    get(providerId) {
        return this.#providers.get(providerId);
    }
    list() {
        return [...this.#providers.values()];
    }
}
export function createDefaultProviderRegistry() {
    const registry = new InMemoryProviderRegistry();
    registry.register(new JusticeProvider());
    registry.register(new NsudProvider());
    registry.register(new UstavnyProvider());
    return registry;
}
//# sourceMappingURL=registry.js.map