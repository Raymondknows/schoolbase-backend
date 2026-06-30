declare module 'node-cache' {
  interface NodeCacheOptions {
    stdTTL?: number;
    checkperiod?: number;
    useClones?: boolean;
    deleteOnExpire?: boolean;
  }

  class NodeCache {
    constructor(options?: NodeCacheOptions);
    get<T = any>(key: string): T | undefined;
    set<T = any>(key: string, value: T, ttl?: number): boolean;
    del(keys: string | string[]): number;
    flushAll(): void;
    keys(): string[];
  }

  export = NodeCache;
  export default NodeCache;
}
