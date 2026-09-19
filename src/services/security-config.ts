function requiredSecret(name: 'SESSION_SECRET' | 'JWT_SECRET'): Uint8Array {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required; refusing to use an insecure default secret`);
  }
  return new TextEncoder().encode(value);
}

export function getSessionSecret(): Uint8Array {
  return requiredSecret('SESSION_SECRET');
}

export function getJwtSecret(): Uint8Array {
  return requiredSecret('JWT_SECRET');
}
