// Thrown for a permanent failure (a 4xx that won't succeed on retry): the worker
// dead-letters it immediately instead of burning the backoff schedule. A leaf
// module so both the QBO client and the worker can share it without a cycle.
export class PermanentError extends Error {}
