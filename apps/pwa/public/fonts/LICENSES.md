# Bundled font licences and provenance

These eight WOFF2 files are redistributed under the SIL Open Font License,
Version 1.1 (OFL-1.1). The SHA-256 values bind each notice and source URL to
the bytes in this directory. The complete licence text is
[`OFL-1.1.txt`](./OFL-1.1.txt).

## Chakra Petch

All four files embed this copyright: Copyright 2018 The Chakra Petch Project
Authors (https://github.com/m4rc1e/Chakra-Petch.git).

### `chakra-petch-400.woff2`

- Embedded name and version: Chakra Petch Regular, 1.000
- SHA-256: `7d75be85dd1627e27ec151e9a3701e661bc4f8c2a93611bdd92f3a05d6bbd942`
- Exact distribution source: [Google Fonts CDN](https://fonts.gstatic.com/s/chakrapetch/v13/cIf6MapbsEk7TDLdtEz1BwkWn6pg.woff2)

### `chakra-petch-500.woff2`

- Embedded name and version: Chakra Petch Medium, 1.000
- SHA-256: `36ad966cb653de70ba37355c41003b02de8940b2df6cbcd46480a6ad8cadd65d`
- Exact distribution source: [Google Fonts CDN](https://fonts.gstatic.com/s/chakrapetch/v13/cIflMapbsEk7TDLdtEz1BwkebIl1R5_F.woff2)

### `chakra-petch-600.woff2`

- Embedded name and version: Chakra Petch SemiBold, 1.000
- SHA-256: `a5888696e9eb1b4bbbecc8eb3922b8369f49d4bddb72263e033cbd17f399be76`
- Exact distribution source: [Google Fonts CDN](https://fonts.gstatic.com/s/chakrapetch/v13/cIflMapbsEk7TDLdtEz1BwkeQI51R5_F.woff2)

### `chakra-petch-700.woff2`

- Embedded name and version: Chakra Petch Bold, 1.000
- SHA-256: `ce5095dc1cb200aaa939e38067a0677018d10e9f26ec38cdcf1557ac524fc775`
- Exact distribution source: [Google Fonts CDN](https://fonts.gstatic.com/s/chakrapetch/v13/cIflMapbsEk7TDLdtEz1BwkeJI91R5_F.woff2)

Upstream licence record: [Chakra Petch OFL](https://github.com/google/fonts/blob/main/ofl/chakrapetch/OFL.txt).

## JetBrains Mono

All three paths intentionally contain the same variable-font bytes; separate
URLs let the existing weight-specific `@font-face` rules stay explicit. They
embed JetBrains Mono version 2.211 and this copyright: Copyright 2020 The
JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono).

### `jetbrains-mono-400.woff2`

- SHA-256: `83c005d49d8a6a50474c73a5a36ac0468076e9c4a29da7bdb14995d80560a5be`
- Exact distribution source: [Google Fonts CDN](https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPxDcwg.woff2)

### `jetbrains-mono-500.woff2`

- SHA-256: `83c005d49d8a6a50474c73a5a36ac0468076e9c4a29da7bdb14995d80560a5be`
- Exact distribution source: [Google Fonts CDN](https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPxDcwg.woff2)

### `jetbrains-mono-700.woff2`

- SHA-256: `83c005d49d8a6a50474c73a5a36ac0468076e9c4a29da7bdb14995d80560a5be`
- Exact distribution source: [Google Fonts CDN](https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPxDcwg.woff2)

Upstream licence record: [JetBrains Mono OFL](https://github.com/JetBrains/JetBrainsMono/blob/master/OFL.txt).

## Google Sans

The app's theme face. Google released this family under the OFL; it is not the
closed brand font it used to be, which is why it can sit in this file alongside
the others rather than being an exception to it.

Fetched once and served from `/fonts/`. The app never links
`fonts.googleapis.com` at runtime - that would hand Google the IP of every
driver on every cold start, which is the exposure this product exists to reduce,
and it would leave the face missing offline on a PWA built to work without a
network.

The file embeds this copyright: Copyright 2025 The Google Sans Project
Authors (github.com/googlefonts/googlesans). Its `nameID 14` points at
https://openfontlicense.org, so the OFL grant is asserted by the binary
itself and not only by the page it was fetched from.

### `google-sans-latin.woff2`

- Embedded name and version: Google Sans 18pt Regular, Version 13.002;[5e3df34c1]
- Variable file covering weights 400-700 in one 36 KB download
- Latin subset, matching the `unicode-range` declared in `styles/tokens.css`
- SHA-256: `3f43e613a4176decfb0ab2e4cf68bfcfbebe9eee1a3de080c4115426258fa32f`
- Exact distribution source: [Google Fonts CDN](https://fonts.gstatic.com/s/googlesans/v70/4UasrENHsxJlGDuGo1OIlJfC6l_24rlCK1Yo_Iqcsih3SAyH6cAwhX9RPjIUvQ.woff2)

Upstream licence record: [Google Sans on Google Fonts](https://fonts.google.com/specimen/Google+Sans).
