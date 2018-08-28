/*
 This file is part of web3.js.

 web3.js is free software: you can redistribute it and/or modify
 it under the terms of the GNU Lesser General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 web3.js is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU Lesser General Public License for more details.

 You should have received a copy of the GNU Lesser General Public License
 along with web3.js.  If not, see <http://www.gnu.org/licenses/>.
 */
/**
 * @file accounts.js
 * @author Fabian Vogelsteller <fabian@ethereum.org>
 * @date 2017
 */

"use strict";

const _ = require("underscore");
const Promise = require('any-promise');
const uuid = require('uuid');
const BN = require('bn.js');

const accountsCrypto = require('./accounts-crypto');
const blake2b256 = accountsCrypto.blake2b256;
const nacl = accountsCrypto.nacl;
const scryptsy = accountsCrypto.scrypt;
const cryp = accountsCrypto.node;

const {
    toBuffer,
    removeLeadingZeroX,
    bufferToZeroXHex,
    inputCallFormatter,
    numberToHex,
    isHexStrict
} = require('./accounts-format');

const {
    createKeyPair,
    createA0Address,
    aionPubSigLen
} = require('./accounts-util');

const rlp = require('aion-rlp');
const AionLong = rlp.AionLong;

const isNot = function(value) {
    return (_.isUndefined(value) || _.isNull(value));
};

const Accounts = function Accounts() {
    var _this = this;
    this.wallet = new Wallet(this);
};

const toAionLong = (val) => {
    let num;
    if (
        val === undefined ||
        val === null ||
        val === '' ||
        val === '0x'
    ) {
      return null;
    }

    if (typeof val === 'string') {
        if (
            val.indexOf('0x') === 0 ||
            val.indexOf('0') === 0 ||
            isHex(val) === true ||
            isHexStrict(val) === true
        ) {
            num = new BN(removeLeadingZeroX(val), 16);
        } else {
            num = new BN(val, 10);
        }
    }

    if (typeof val === 'number') {
      num = new BN(val);
    }

    return new AionLong(num);
};

Accounts.prototype._addAccountFunctions = function (account) {
    var _this = this;

    // add sign functions
    account.signTransaction = function signTransaction(tx, callback) {
        return _this.signTransaction(tx, account.privateKey, callback);
    };
    account.sign = function sign(data) {
        return _this.sign(data, account.privateKey);
    };

    account.encrypt = function encrypt(password, options) {
        return _this.encrypt(account.privateKey, password, options);
    };


    return account;
};

// replaces ethlib/lib/account.js#fromPrivate
const createAionAccount = function (opts) {
    const account = createKeyPair({
        privateKey: opts.privateKey,
        entropy: opts.entropy
    });
    account.address = createA0Address(account.publicKey);
    return account;
};

Accounts.prototype.create = function create(entropy) {
    return this._addAccountFunctions(createAionAccount({entropy: entropy}));
};

Accounts.prototype.privateKeyToAccount = function privateKeyToAccount(privateKey) {
    return this._addAccountFunctions(createAionAccount({privateKey: privateKey}));
};

/**
 * Note: has reduced functionality, does not query server if chainId, gasPrice or nonce
 * is not provided by the user. Instead it will reject the promise.
 */
Accounts.prototype.signTransaction = function signTransaction(tx, privateKey, callback) {
    const _this = this;
    let error = false, result;

    const account = this.privateKeyToAccount(privateKey);

    callback = callback || function () {};

    if (!tx) {
        error = new Error('No transaction object given!');

        callback(error, null);
        return Promise.reject(error);
    }

    const signed = (tx) => {

        if (!tx.gas && !tx.gasLimit) {
            error = new Error('"gas" is missing');
        }

        if (tx.nonce  < 0 ||
            tx.gas  < 0 ||
            tx.gasPrice  < 0 ||
            tx.chainId  < 0 ||
            tx.type < 0) {
            error = new Error('Gas, gasPrice, nonce or chainId is lower than 0');
        }

        if (error) {
            callback(error);
            return Promise.reject(error);
        }

        try {
            tx = inputCallFormatter(tx);

            var transaction = tx;
            transaction.to = tx.to || '0x';
            transaction.data = tx.data || '0x';
            transaction.value = tx.value || '0x';
            transaction.timestamp = tx.timestamp || Math.floor(Date.now() / 1000);
            transaction.type = numberToHex(tx.type || 1);

            var rlpEncoded = rlp.encode([
                transaction.nonce,
                transaction.to.toLowerCase(),
                transaction.value,
                transaction.data,
                transaction.timestamp,
                toAionLong(transaction.gas),
                toAionLong(transaction.gasPrice),
                transaction.type
            ]);

            // hash encoded message
            var hash = blake2b256(rlpEncoded);

            // sign with nacl
            var signature = toBuffer(nacl.sign.detached(hash, account.privateKey));

            // verify nacl signature
            if (nacl.sign.detached.verify(hash, signature, account.publicKey) === false) {
                throw new Error('Could not verify signature.');
            }

            // aion-specific signature scheme
            var aionPubSig = Buffer.concat([account.publicKey, signature], aionPubSigLen);

            // add the aion pub-sig
            var rawTx = rlp.decode(rlpEncoded).concat(aionPubSig);

            // re-encode with signature included
            var rawTransaction = rlp.encode(rawTx);

            result = {
                messageHash: bufferToZeroXHex(hash),
                signature: bufferToZeroXHex(aionPubSig),
                rawTransaction: bufferToZeroXHex(rawTransaction)
            };

        } catch(e) {
            callback(e, null);
            return Promise.reject(e);
        }

        callback(null, result);
        return result;
    }

    // Resolve immediately if nonce, chainId and price are provided
    if (tx.nonce !== undefined && tx.gasPrice !== undefined) {
        return Promise.resolve(signed(tx));
    }

    // otherwise if either of these things aren't provided, simply throw
    return Promise.reject(new Error("nonce, chainId or gasPrice was not provided"));
};

/* jshint ignore:start */
Accounts.prototype.recoverTransaction = function recoverTransaction(rawTx) {
    return this.recover(null, rlp.decode(rawTx).pop());
};
/* jshint ignore:end */


Accounts.prototype.hashMessage = function hashMessage(data) {
    throw new Error("functionality currently not supported");

    var message = isHexStrict(data) ? Buffer.from(data.substring(2), 'hex') : data;
    var messageBuffer = Buffer.from(message);
    var preamble = "\Aion Signed Message:\n" + message.length;
    var preambleBuffer = Buffer.from(preamble);
    var ethMessage = Buffer.concat([preambleBuffer, messageBuffer]);
    return "0x" + blake2b256(ethMessage).toString('hex');
};

Accounts.prototype.sign = function sign(data, privateKey) {
    throw new Error("functionality currently not supported");

    var account = this.privateKeyToAccount(privateKey);
    var publicKey = account.publicKey;
    var hash = this.hashMessage(data);
    var signature = toBuffer(
        nacl.sign.detached(
            toBuffer(hash),
            toBuffer(privateKey)
        )
    );
    // address + message signature
    var aionPubSig = Buffer.concat(
        [toBuffer(publicKey), toBuffer(signature)],
        aionPubSigLen
    );
    return {
        message: data,
        messageHash: hash,
        signature: bufferToZeroXHex(aionPubSig)
    };
};

Accounts.prototype.recover = function recover(message, signature) {
    const sig = signature || (message && message.signature);
    const publicKey = toBuffer(sig).slice(0, nacl.sign.publicKeyLength);
    return createA0Address(publicKey);
};

// Taken from https://github.com/ethereumjs/ethereumjs-wallet
Accounts.prototype.decrypt = function (v3Keystore, password, nonStrict) {
    /* jshint maxcomplexity: 10 */

    if(!_.isString(password)) {
        throw new Error('No password given.');
    }

    const json = (_.isObject(v3Keystore)) ? v3Keystore : JSON.parse(nonStrict ? v3Keystore.toLowerCase() : v3Keystore);

    if (json.version !== 3) {
        throw new Error('Not a valid V3 wallet');
    }

    let derivedKey;
    let kdfparams;
    if (json.crypto.kdf === 'scrypt') {
        kdfparams = json.crypto.kdfparams;

        // FIXME: support progress reporting callback
        derivedKey = scryptsy(new Buffer(password), new Buffer(kdfparams.salt, 'hex'), kdfparams.n, kdfparams.r, kdfparams.p, kdfparams.dklen);
    } else if (json.crypto.kdf === 'pbkdf2') {
        throw new Error('pbkdf2 is unsupported by AION keystore format');
    } else {
        throw new Error('Unsupported key derivation scheme');
    }

    const ciphertext = new Buffer(json.crypto.ciphertext, 'hex');

    let mac = blake2b256(Buffer.concat([ derivedKey.slice(16, 32), ciphertext ])).toString('hex');
    if (mac !== json.crypto.mac) {
        throw new Error('Key derivation failed - possibly wrong password');
    }

    const decipher = cryp.createDecipheriv(json.crypto.cipher, derivedKey.slice(0, 16), new Buffer(json.crypto.cipherparams.iv, 'hex'));
    const seed = '0x'+ Buffer.concat([ decipher.update(ciphertext), decipher.final() ]).toString('hex');
    return this.privateKeyToAccount(seed);
};

Accounts.prototype.encrypt = function (privateKey, password, options, fast = true) {
    /* jshint maxcomplexity: 20 */
    var account = this.privateKeyToAccount(privateKey);

    options = options || {};
    const salt = options.salt || cryp.randomBytes(32);
    const iv = options.iv || cryp.randomBytes(16);

    // removed support for pbkdf2, we don't support it on the kernel side
    // doesn't make sense to allow this if we want kernel compatibility
    if ((options.kdf !== null || options.kdf !== undefined) && options.kdf === 'pbkdf2') {
        throw new Error("pbkdf2 format unsupported, use scrypt");
    }

    let derivedKey;
    const kdf = options.kdf || 'scrypt';
    const kdfparams = {
        dklen: options.dklen || 32,
        salt: salt.toString('hex')
    };

    if (kdf === 'pbkdf2') {
        kdfparams.c = options.c || 262144;
        kdfparams.prf = 'hmac-sha256';
        derivedKey = cryp.pbkdf2Sync(new Buffer(password), salt, kdfparams.c, kdfparams.dklen, 'sha256');
    } else if (kdf === 'scrypt') {
        // FIXME: support progress reporting callback
        // support fast identifier, enabled by default, but gives the user the option
        // to switch to iterations identical to kernel side (but this will be CPU intensive)
        kdfparams.n = options.n || fast ? 8192 : 262144; // 2048 4096 8192 16384
        kdfparams.r = options.r || 8;
        kdfparams.p = options.p || 1;
        derivedKey = scryptsy(new Buffer(password), salt, kdfparams.n, kdfparams.r, kdfparams.p, kdfparams.dklen);
    } else {
        throw new Error('Unsupported kdf');
    }

    const cipher = cryp.createCipheriv(options.cipher || 'aes-128-ctr', derivedKey.slice(0, 16), iv);
    if (!cipher) {
        throw new Error('Unsupported cipher');
    }

    const ciphertext = Buffer.concat([ cipher.update(new Buffer(account.privateKey.replace('0x',''), 'hex')), cipher.final() ]);

    const mac = blake2b256(
            Buffer.concat(
                [derivedKey.slice(16, 32),
                new Buffer(ciphertext, 'hex')]
            )
        ).toString('hex');

    return {
        version: 3,
        id: uuid.v4({ random: options.uuid || cryp.randomBytes(16) }),
        address: account.address.toLowerCase().replace('0x',''),
        crypto: {
            ciphertext: ciphertext.toString('hex'),
            cipherparams: {
                iv: iv.toString('hex')
            },
            cipher: options.cipher || 'aes-128-ctr',
            kdf: kdf,
            kdfparams: kdfparams,
            mac: mac.toString('hex')
        }
    };
};

Accounts.prototype.encryptToRlp = function(privateKey, password, options) {
    return toRlp(this.encrypt(privateKey, password, options));
}


Accounts.prototype.decryptFromRlp = function(buffer, password) {
    return this.decrypt(fromRlp(buffer), password);
}

/**
 * Serializes ksv3 object into buffer
 * https://github.com/aionnetwork/aion/blob/tx_encoding_tests/modMcf/src/org/aion/mcf/account/KeystoreItem.java
 *
 * @method toRlp
 * @param {object} ksv3 (struct)
 * @return {buffer} Keystore (serialized)
 */
const toRlp = (ksv3) => {
    const _kdfparams = [];
    _kdfparams[0] = "";
    _kdfparams[1] = ksv3.crypto.kdfparams.dklen;
    _kdfparams[2] = ksv3.crypto.kdfparams.n;
    _kdfparams[3] = ksv3.crypto.kdfparams.p;
    _kdfparams[4] = ksv3.crypto.kdfparams.r;
    _kdfparams[5] = ksv3.crypto.kdfparams.salt.toString('hex');
    const kdfparams = rlp.encode(_kdfparams);

    const _cipherparams = [];
    _cipherparams[0] = ksv3.crypto.cipherparams.iv.toString('hex');
    let Cipherparams = rlp.encode(_cipherparams);

    const _crypto = [];
    _crypto[0] = 'aes-128-ctr';
    _crypto[1] = ksv3.crypto.ciphertext.toString('hex');
    _crypto[2] = "scrypt";
    _crypto[3] = ksv3.crypto.mac;
    _crypto[4] = Cipherparams;
    _crypto[5] = Kdfparams;
    const crypto = rlp.encode(_crypto);

    const _keystore = [];
    _keystore[0] = ksv3.id;
    _keystore[1] = 3;
    _keystore[2] = ksv3.address;
    _keystore[3] = Crypto;
    const keystore = rlp.encode(_keystore);
    return keystore;
}

/**
 * Deserializes keystore into ksv3 object
 * https://github.com/aionnetwork/aion/blob/tx_encoding_tests/modMcf/src/org/aion/mcf/account/KeystoreItem.java
 *
 * @method fromRlp
 * @param {object} Keystore (serialized)
 * @return {buffer} ksv3 (struct)
 */
const fromRlp = (keystore) => {

    // Store return ksv3 object
    const Ksv3 = rlp.decode(Buffer.from(keystore, 'hex'));
    const Crypto = rlp.decode(Ksv3[3]);
    const Cipherparams = rlp.decode(Crypto[4]);
    const Kdfparams = rlp.decode(Crypto[5]);

    return {
        id: Ksv3[0].toString('utf8'),
        version: parseInt(Ksv3[1].toString('hex'), 16),
        address: Ksv3[2].toString('utf8'),
        crypto: {
            cipher: Crypto[0].toString('utf8'),
            ciphertext: Crypto[1].toString('utf8'),
            kdf: Crypto[2].toString('utf8'),
            mac: Crypto[3].toString('utf8'),
            cipherparams: {
                iv: Cipherparams[0].toString('utf8')
            },
            kdfparams: {
                dklen: parseInt(Kdfparams[1].toString('hex'), 16),
                n: parseInt(Kdfparams[2].toString('hex'), 16),
                p: parseInt(Kdfparams[3].toString('hex'), 16),
                r: parseInt(Kdfparams[4].toString('hex'), 16),
                salt: Kdfparams[5].toString('utf8')
            }
        }
    };
}


// Note: this is trying to follow closely the specs on
// http://web3js.readthedocs.io/en/1.0/web3-eth-accounts.html

function Wallet(accounts) {
    this._accounts = accounts;
    this.length = 0;
    this.defaultKeyName = "web3js_wallet";
}

Wallet.prototype._findSafeIndex = function (pointer) {
    pointer = pointer || 0;
    if (_.has(this, pointer)) {
        return this._findSafeIndex(pointer + 1);
    } else {
        return pointer;
    }
};

Wallet.prototype._currentIndexes = function () {
    var keys = Object.keys(this);
    var indexes = keys
        .map(function(key) { return parseInt(key); })
        .filter(function(n) { return (n < 9e20); });

    return indexes;
};

Wallet.prototype.create = function (numberOfAccounts, entropy) {
    for (var i = 0; i < numberOfAccounts; ++i) {
        this.add(this._accounts.create(entropy).privateKey);
    }
    return this;
};

Wallet.prototype.add = function (account) {

    if (_.isString(account)) {
        account = this._accounts.privateKeyToAccount(account);
    }
    if (!this[account.address]) {
        account = this._accounts.privateKeyToAccount(account.privateKey);
        account.index = this._findSafeIndex();

        this[account.index] = account;
        this[account.address] = account;
        this[account.address.toLowerCase()] = account;

        this.length++;

        return account;
    } else {
        return this[account.address];
    }
};

Wallet.prototype.remove = function (addressOrIndex) {
    var account = this[addressOrIndex];

    if (account && account.address) {
        // address
        this[account.address].privateKey = null;
        delete this[account.address];
        // address lowercase
        this[account.address.toLowerCase()].privateKey = null;
        delete this[account.address.toLowerCase()];
        // index
        this[account.index].privateKey = null;
        delete this[account.index];

        this.length--;

        return true;
    } else {
        return false;
    }
};

Wallet.prototype.clear = function () {
    var _this = this;
    var indexes = this._currentIndexes();

    indexes.forEach(function(index) {
        _this.remove(index);
    });

    return this;
};

Wallet.prototype.encrypt = function (password, options) {
    var _this = this;
    var indexes = this._currentIndexes();

    var accounts = indexes.map(function(index) {
        return _this[index].encrypt(password, options);
    });

    return accounts;
};


Wallet.prototype.decrypt = function (encryptedWallet, password) {
    var _this = this;

    encryptedWallet.forEach(function (keystore) {
        var account = _this._accounts.decrypt(keystore, password);

        if (account) {
            _this.add(account);
        } else {
            throw new Error('Couldn\'t decrypt accounts. Password wrong?');
        }
    });

    return this;
};

Wallet.prototype.save = function (password, keyName) {
    localStorage.setItem(keyName || this.defaultKeyName, JSON.stringify(this.encrypt(password)));

    return true;
};

Wallet.prototype.load = function (password, keyName) {
    var keystore = localStorage.getItem(keyName || this.defaultKeyName);

    if (keystore) {
        try {
            keystore = JSON.parse(keystore);
        } catch(e) {

        }
    }

    return this.decrypt(keystore || [], password);
};

if (typeof localStorage === 'undefined') {
    delete Wallet.prototype.save;
    delete Wallet.prototype.load;
}

module.exports = Accounts;
