/**
 * Device cryptography: the signed, hash-chained evidence log and the local
 * plate vault. Browser-native Web Crypto only - there is no crypto dependency
 * in this product and there must not be one.
 *
 * Start here:
 *   cryptoAvailability()      probe first; it can say no, and it often will
 *   createEvidenceChain()     finalize() signs a report or throws, never both
 *   verifyChain()             order, linkage and signatures, first break wins
 *   createPlateVault()        plates encrypted at rest, decrypted only in RAM
 *
 * The rule the whole module is built around: nothing here ever reports that a
 * record is signed unless a key that survives a reload actually signed it.
 */

export {
  ByteFormatError,
  concatBytes,
  constantTimeEqualHex,
  fromBase64Url,
  fromHex,
  isHash256Hex,
  sha256Bytes,
  sha256Hex,
  toBase64Url,
  toHex,
  utf8,
  utf8Decode,
} from './bytes';

export {
  CANONICAL_FORM,
  CanonicalizationError,
  FRACTION_DIGITS,
  MAX_DEPTH,
  MAX_NON_INTEGER_MAGNITUDE,
  canonicalBytes,
  canonicalize,
  isPlainObject,
} from './canonicalize';
export type {
  CanonicalObject,
  CanonicalPrimitive,
  CanonicalValue,
  CanonicalizationErrorCode,
} from './canonicalize';

export {
  CRYPTO_DB_NAME,
  CRYPTO_DB_VERSION,
  CryptoUnavailableError,
  INDEX_ALGORITHM,
  KEY_STORE_NAME,
  PLATE_INDEX_KEY_ID,
  PLATE_STORE_NAME,
  PLATE_VAULT_KEY_ID,
  SIGNING_ALGORITHM,
  SIGNING_PARAMS,
  SIGNING_PRIVATE_KEY_ID,
  SIGNING_PUBLIC_KEY_ID,
  VAULT_ALGORITHM,
  createKeyManager,
  cryptoAvailability,
  hasIndexedDb,
  indexedDbKeyStore,
  memoryKeyStore,
  openCryptoDb,
  resetCryptoDbHandle,
} from './keys';
export type {
  CryptoAvailability,
  CryptoDeps,
  CryptoUnavailableReason,
  KeyDurability,
  KeyManager,
  KeyManagerOptions,
  KeyStoreKind,
  MemoryKeyStoreOptions,
  PersistentKeyStore,
  SigningKeys,
} from './keys';

export {
  CAPTURED_AT_RE,
  EVIDENCE_SCHEMA,
  EvidenceInputError,
  GENESIS_CHAIN_HASH,
  GENESIS_PREIMAGE,
  GPS_ACCURACY_FIELD,
  REPORT_ID_RE,
  advanceSyncState,
  chainHeadOf,
  computeChainHash,
  createEvidenceChain,
  formatHashForDisplay,
  randomUuid,
  verifyChain,
} from './chain';
export type {
  ChainFailure,
  ChainFailureCode,
  ChainVerification,
  EvidenceChain,
  EvidenceChainOptions,
  EvidenceRecord,
  FinalizeInput,
  SyncState,
  VerifyChainOptions,
} from './chain';

export {
  BLIND_INDEX_BYTES,
  EXPORT_WARNING,
  IV_LENGTH,
  InvalidPlateError,
  PLATE_AAD_PREFIX,
  PLATE_INDEX_PREFIX,
  PLATE_SCHEMA,
  PlateExportNotConfirmedError,
  createPlateVault,
  indexedDbPlateStore,
  memoryPlateStore,
  normalisePlate,
} from './plate';
export type {
  PlateExport,
  PlateExportEntry,
  PlateMatch,
  PlateVault,
  PlateVaultOptions,
  SealedPlate,
  SealedPlateStore,
  SealedPlateSummary,
} from './plate';
