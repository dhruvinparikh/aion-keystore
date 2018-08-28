/**
 * accounts-util.js utility files for accounts
 *
 * This is ported over from a currently unreleased version of aion-web3 1.0. For more information see:
 * https://github.com/aionnetwork/aion_web3/issues/10
 */

let {isString, isArray} = require('underscore');
let {blake2b256, nacl} = require('./accounts-crypto');

// static values
const A0_IDENTIFIER = new Buffer('a0', 'hex');
const ADDRESS_PATTERN = require('./accounts-pattern').address;

let {
  prependZeroX,
  removeLeadingZeroX,
  randomHexBuffer,
  // Buffer,
  toBuffer
} = require('./accounts-format')

// address + message signature length
let aionPubSigLen = nacl.sign.publicKeyLength + nacl.sign.signatureLength

function createKeyPair({entropy, privateKey}) {
  let kp
  let keyPair

  if (privateKey !== undefined) {
    kp = nacl.sign.keyPair.fromSecretKey(toBuffer(privateKey))
    keyPair = {
      _privateKey: toBuffer(kp.secretKey),
      _publicKey: toBuffer(kp.publicKey)
    }
    return keyPair
  }

  if (entropy === undefined) {
    entropy = randomHexBuffer()
  }

  if (entropy.length !== nacl.sign.seedLength) {
    /*eslint-disable no-console*/
    // for some reason the entropy has intermittent problems
    console.log('entropy', entropy)
    console.log('entropy.length', entropy.length)
    /*eslint-enable no-console*/
  }

  kp = nacl.sign.keyPair.fromSeed(entropy.slice(0, nacl.sign.seedLength))
  keyPair = {
    _privateKey: toBuffer(kp.secretKey),
    _publicKey: toBuffer(kp.publicKey)
  }
  return keyPair
}

let isPrivateKey = val =>
  (isArray(val) === true || Buffer.isBuffer(val) === true) && val.length > 0

function createA0Address(publicKey) {
  let pkHash = Buffer.from(blake2b256(publicKey)).slice(1, 32)
  let address = Buffer.concat([A0_IDENTIFIER, pkHash], 32)
  return prependZeroX(address.toString('hex'))
}

function isAccountAddress(val) {
  if (val === undefined || isString(val) === false) {
    return false
  }

  return ADDRESS_PATTERN.test(val) === true
}

function bit(arr, index) {
  let byteOffset = Math.floor(index / 8)
  let bitOffset = index % 8
  let uint8 = arr[byteOffset]
  return (uint8 >> bitOffset) & 0x1
}

function createChecksumAddress(val) {
  let address = removeLeadingZeroX(val.toLowerCase())
  let addressHash = blake2b256(toBuffer(address))

  return prependZeroX(
    address
      .split('')
      .map((item, index) => {
        let char = address[index]

        if (isNaN(char) === false) {
          // numeric
          return char
        }

        return bit(addressHash, index) === 1
          ? char.toUpperCase()
          : char.toLowerCase()
      })
      .join('')
  )
}

let isValidChecksumAddress = val => val === createChecksumAddress(val)

function equalAddresses(addr1, addr2) {
  return (
    removeLeadingZeroX(addr1.toLowerCase()) ===
    removeLeadingZeroX(addr2.toLowerCase())
  )
}

module.exports = {
  createKeyPair,
  isPrivateKey,
  createA0Address,
  isAccountAddress,
  createChecksumAddress,
  isValidChecksumAddress,
  equalAddresses,
  aionPubSigLen
}