# Dead-drop gap contract fixture

This fixture contains the public, testable contract behind the dead-drop gap
markers. It deliberately contains no internal review notes or design-source
references.

## <a id="only-two-queue-states-are-drawn"></a>Only two queue states are drawn

All queue states remain visible even when the reference panel only drew held
and synced rows.

## <a id="a-device-with-no-webcrypto-says-so"></a>A device without WebCrypto says so

An unavailable verifier is shown as an unavailable check, not as failed
evidence.

## <a id="signed-row-is-a-verification-not-a-label"></a>The signed row is a verification

The only verdict labels the model may render are `DEVICE KEY OK`,
`CHAIN BROKEN`, `UNVERIFIED`, and `BODY NOT HELD`.

## <a id="no-empty-or-loading-state-is-drawn"></a>Empty and loading states are explicit

Opening the queue and finding no rows are distinct states.

## <a id="place-names-cannot-be-produced-without-a-geocoder"></a>Place names require a geocoder

The view does not invent a place name from coordinates.

## <a id="photo-row-has-nothing-to-count"></a>The photo row has nothing to count

Photo copy reports only what the signed record can establish.

## <a id="an-export-carries-bodies-not-rows"></a>An export carries bodies, not rows

An evidence export distinguishes a queue index row from its retained body.

## <a id="heading-row-has-no-speed"></a>The heading row has no speed

Heading and speed remain separate facts.

## <a id="every-timestamp-is-utc"></a>Every timestamp is UTC

Display formatting cannot silently turn a signed UTC instant into local time.

## <a id="export-json-has-no-sink-on-this-device"></a>Export may have no device sink

The export action reports when the platform cannot save or share its result.

## <a id="the-callout-tint"></a>The callout tint

The callout uses an existing token rather than inventing a colour.

## <a id="queueddrop-label-carries-a-camera-id-not-a-place"></a>The queue label is a camera id

`stores/sync.ts` writes the shared label from `camera_id`; callers must not
present it as a reverse-geocoded place.

## <a id="a-purge-can-leave-a-hole-in-the-middle"></a>A purge can leave an interior hole

Verification reports contiguous `runs` and preserves the
`starting_chain_hash`; an interior purge is missing retained material, not
proof that a later signature was altered.

## <a id="the-signing-key-is-not-pinned"></a>The signing key is not pinned

Verification accepts an optional `expectedPublicKeyId`; the queue deliberately
does not assume that every retained record came from this installation.

## <a id="type-and-spacing-steps-the-token-set-misses"></a>Type and spacing substitutions

The `SEND NOW` action uses the nearest existing 13px type step.
