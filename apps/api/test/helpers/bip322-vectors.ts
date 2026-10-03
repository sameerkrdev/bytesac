// Official BIP-322 "simple" test vectors, copied from https://github.com/bitcoin/bips/tree/master/bip-0322 (basic-test-vectors.json and generated-test-vectors.json).
// Supported address types only (P2WPKH, P2TR); the multisig, legacy and "full" vectors are out of scope.
export const VALID = [
  {
    "message": "",
    "address": "bc1q9vza2e8x573nczrlzms0wvx3gsqjx7vavgkx0l",
    "type": "p2wpkh",
    "signatures": [
      "smpAkcwRAIgM2gBAQqvZX15ZiysmKmQpDrG83avLIT492QBzLnQIxYCIBaTpOaD20qRlEylyxFSeEA2ba9YOixpX8z46TSDtS40ASECx/EgAxlkQpQ9hYjgGu6EBCPMVPwVIVJqO4XCsMvViHI=",
      "smpAkgwRQIhAPkJ1Q4oYS0htvyuSFHLxRQpFAY56b70UvE7Dxazen0ZAiAtZfFz1S6T6I23MWI2lK/pcNTWncuyL8UL+oMdydVgzAEhAsfxIAMZZEKUPYWI4BruhAQjzFT8FSFSajuFwrDL1Yhy"
    ]
  },
  {
    "message": "Hello World",
    "address": "bc1q9vza2e8x573nczrlzms0wvx3gsqjx7vavgkx0l",
    "type": "p2wpkh",
    "signatures": [
      "smpAkcwRAIgZRfIY3p7/DoVTty6YZbWS71bc5Vct9p9Fia83eRmw2QCICK/ENGfwLtptFluMGs2KsqoNSk89pO7F29zJLUx9a/sASECx/EgAxlkQpQ9hYjgGu6EBCPMVPwVIVJqO4XCsMvViHI=",
      "smpAkgwRQIhAOzyynlqt93lOKJr+wmmxIens//zPzl9tqIOua93wO6MAiBi5n5EyAcPScOjf1lAqIUIQtr3zKNeavYabHyR8eGhowEhAsfxIAMZZEKUPYWI4BruhAQjzFT8FSFSajuFwrDL1Yhy"
    ]
  },
  {
    "message": "2V6TUTMSH4VQ3Z7WZWKYD7DFNH",
    "address": "bc1qqthe0hz8klx90e7stf6shclhsvqd5ly96pn53v",
    "type": "p2wpkh",
    "signatures": [
      "smpAkgwRQIhALC6hdfxNy1n45d7UXSskRBdfZW0Al259E1kDMpipdYkAiAJPfZqb+WurZuf1apU5xeE6Igui9dvt5tihQLDvxlY1AEhAqbnruyo677ktQjio7XOchO3w51Dh9AbRVngha5jtNfT"
    ]
  },
  {
    "message": "PURVOQ544B6HUATVBJZN5EZJUU",
    "address": "bc1pcquvhrqv0q68t4m0hfq6tpn006qrskyc7yrqnp2uyrf2emg3wynsdjyk38",
    "type": "p2tr",
    "signatures": [
      "smpAUB6B2Rbupzua8LTQIF06516wzl+cwKy1be8RgoiW0riyXdKwe6GTz/5Hnb37m67pJwIKCh+D5jDueG6KpvYpmu8"
    ]
  }
] as const;

export const INVALID = [
  {
    "description": "wrong message for p2wpkh simple signature",
    "message": "EFGJ4AZYXDV7NDUDSUDB3NCDUC",
    "address": "bc1qqthe0hz8klx90e7stf6shclhsvqd5ly96pn53v",
    "signature": "smpAkgwRQIhALC6hdfxNy1n45d7UXSskRBdfZW0Al259E1kDMpipdYkAiAJPfZqb+WurZuf1apU5xeE6Igui9dvt5tihQLDvxlY1AEhAqbnruyo677ktQjio7XOchO3w51Dh9AbRVngha5jtNfT"
  },
  {
    "description": "wrong signer for p2wpkh simple signature",
    "message": "2V6TUTMSH4VQ3Z7WZWKYD7DFNH",
    "address": "bc1qgg6lpr05az2l5kz402ddz5ez7fdu25kgmd40lf",
    "signature": "smpAkgwRQIhALC6hdfxNy1n45d7UXSskRBdfZW0Al259E1kDMpipdYkAiAJPfZqb+WurZuf1apU5xeE6Igui9dvt5tihQLDvxlY1AEhAqbnruyo677ktQjio7XOchO3w51Dh9AbRVngha5jtNfT"
  },
  {
    "description": "wrong message for p2tr simple signature",
    "message": "56VM6YK6Y76XTBXNPITF232EPX",
    "address": "bc1pcquvhrqv0q68t4m0hfq6tpn006qrskyc7yrqnp2uyrf2emg3wynsdjyk38",
    "signature": "smpAUB6B2Rbupzua8LTQIF06516wzl+cwKy1be8RgoiW0riyXdKwe6GTz/5Hnb37m67pJwIKCh+D5jDueG6KpvYpmu8"
  },
  {
    "description": "wrong signer for p2tr simple signature",
    "message": "PURVOQ544B6HUATVBJZN5EZJUU",
    "address": "bc1pltvk000nd54v3hrrcn7lsffdra72hphpm40rhzf9hn8arqkgermq2p9029",
    "signature": "smpAUB6B2Rbupzua8LTQIF06516wzl+cwKy1be8RgoiW0riyXdKwe6GTz/5Hnb37m67pJwIKCh+D5jDueG6KpvYpmu8"
  }
] as const;
