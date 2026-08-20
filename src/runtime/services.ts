import type {
  RuntimeServiceKey,
  RuntimeServiceRegistry,
} from './types';

interface ServiceEntry {
  readonly service: unknown;
  readonly onDispose?: () => void;
}

export function createRuntimeServiceKey<T>(description: string): RuntimeServiceKey<T> {
  return Symbol.for(`water.runtime.service:${description}`) as RuntimeServiceKey<T>;
}

export class ServiceRegistry implements RuntimeServiceRegistry {
  private readonly entries = new Map<symbol, ServiceEntry>();

  public provide<T>(key: RuntimeServiceKey<T>, service: T, onDispose?: () => void): () => void {
    if (this.entries.has(key)) {
      throw new Error('A runtime service is already registered for this key.');
    }

    this.entries.set(key, { service, onDispose });
    return () => {
      this.remove(key);
    };
  }

  public get<T>(key: RuntimeServiceKey<T>): T | undefined {
    return this.entries.get(key)?.service as T | undefined;
  }

  public require<T>(key: RuntimeServiceKey<T>): T {
    const service = this.get(key);
    if (service === undefined) {
      throw new Error('The requested runtime service is not registered.');
    }
    return service;
  }

  public remove<T>(key: RuntimeServiceKey<T>): boolean {
    const entry = this.entries.get(key);
    if (!entry) {
      return false;
    }

    this.entries.delete(key);
    entry.onDispose?.();
    return true;
  }

  public clear(): void {
    const keys = [...this.entries.keys()];
    const errors: unknown[] = [];
    for (const key of keys) {
      try {
        this.remove(key as RuntimeServiceKey<unknown>);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 1) {
      throw errors[0];
    }
    if (errors.length > 1) {
      throw new AggregateError(errors, 'One or more runtime service disposers failed.');
    }
  }
}
