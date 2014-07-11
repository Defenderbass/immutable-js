class Sequence {
  constructor(value) {
    if (arguments.length === 1) {
      if (value instanceof Sequence) {
        return value;
      }
      if (Array.isArray(value)) {
        return new ArraySequence(value);
      }
      if (value && typeof value === 'object') {
        return new ObjectSequence(value);
      }
    }
    return new ArraySequence(Array.prototype.slice.call(arguments), true);
  }

  toString() {
    return this.__toString('Seq {', '}');
  }

  inspect() {
    return '' + this;
  }

  __toString(head, tail) {
    if (this.length === 0) {
      return head + tail;
    }
    return head + ' ' + this.map(this.__toStringMapper).join(', ') + ' ' + tail;
  }

  __toStringMapper(v, k) {
    return quoteString(k) + ': ' + quoteString(v);
  }

  isMutable() {
    return this.__parentSequence.isMutable();
  }

  asImmutable() {
    // This works because asImmutable() is mutative.
    this.__parentSequence.asImmutable();
    return this;
  }

  toArray() {
    var array = new Array(this.length || 0);
    this.values().forEach((v, i) => { array[i] = v; });
    return array;
  }

  toObject() {
    var object = {};
    this.forEach((v, k) => { object[k] = v; });
    return object;
  }

  toVector() {
    // Use Late Binding here to solve the circular dependency.
    return require('./Vector').empty().merge(this.values());
  }

  toMap() {
    // Use Late Binding here to solve the circular dependency.
    return require('./Map').empty().merge(this);
  }

  toSet() {
    // Use Late Binding here to solve the circular dependency.
    return require('./Set').empty().merge(this);
  }

  equals(other) {
    if (this === other) {
      return true;
    }
    if (this.length != null && other.length != null && this.length !== other.length) {
      return false;
    }
    // if either side is mutable, and they are not from the same parent
    // sequence, then they must not be equal.
    if (((!this.isMutable || this.isMutable()) ||
         (!other.isMutable || other.isMutable())) &&
        (this.__parentSequence || this) !== (other.__parentSequence || other)) {
      return false;
    }
    return this.__deepEquals(other);
  }

  __deepEquals(other) {
    var is = require('./Immutable').is;
    var entries = this.entries().toArray();
    var iterations = 0;
    return other.every((v, k) => {
      var entry = entries[iterations++];
      return is(k, entry[0]) && is(v, entry[1]);
    });
  }

  join(separator) {
    separator = separator || ',';
    var string = '';
    var isFirst = true;
    this.forEach((v, k) => {
      if (isFirst) {
        isFirst = false;
        string += v;
      } else {
        string += separator + v;
      }
    });
    return string;
  }

  concat(...values) {
    var sequences = [this].concat(values.map(value => Sequence(value)));
    var concatSequence = this.__makeSequence();
    concatSequence.__iterate = (fn, reverse) => {
      var shouldBreak;
      var iterations = 0;
      var lastIndex = sequences.length - 1;
      for (var ii = 0; ii <= lastIndex; ii++) {
        var seq = sequences[reverse ? lastIndex - ii : ii];
        iterations += seq.__iterate((v, k, c) => {
          if (fn(v, k, c) === false) {
            shouldBreak = true;
            return false;
          }
        }, reverse);
        if (shouldBreak) {
          break;
        }
      }
      return iterations;
    };
    concatSequence.length = sequences.reduce(
      (sum, seq) => sum != null && seq.length != null ? sum + seq.length : undefined, 0
    );
    return concatSequence;
  }

  reverse(maintainIndices) {
    var sequence = this;
    var reversedSequence = this.__makeSequence();
    reversedSequence.length = this.length;
    reversedSequence.__iterate = (fn, reverse) => {sequence.__iterate(fn, !reverse)};
    reversedSequence.reverse = () => sequence;
    return reversedSequence;
  }

  keys() {
    return this.map(keyMapper).values();
  }

  values() {
    return new ValuesSequence(this, this.length);
  }

  entries() {
    var sequence = this;
    var newSequence = sequence.map(entryMapper).values();
    newSequence.fromEntries = () => sequence;
    return newSequence;
  }

  forEach(sideEffect, context) {
    return this.__iterate(context ? sideEffect.bind(context) : sideEffect);
  }

  first(predicate, context) {
    var firstValue;
    (predicate ? this.filter(predicate, context) : this).take(1).forEach(v => { firstValue = v; });
    return firstValue;
  }

  last(predicate, context) {
    return this.reverse(true).first(predicate, context);
  }

  reduce(reducer, initialReduction, context) {
    var reduction = initialReduction;
    this.forEach((v, k, c) => {
      reduction = reducer.call(context, reduction, v, k, c);
    });
    return reduction;
  }

  reduceRight(reducer, initialReduction, context) {
    return this.reverse(true).reduce(reducer, initialReduction, context);
  }

  every(predicate, context) {
    var returnValue = true;
    this.forEach((v, k, c) => {
      if (!predicate.call(context, v, k, c)) {
        returnValue = false;
        return false;
      }
    });
    return returnValue;
  }

  some(predicate, context) {
    return !this.every(not(predicate), context);
  }

  get(searchKey, notFoundValue) {
    return this.findKey((_, key) => key === searchKey, null, notFoundValue);
  }

  find(predicate, context, notFoundValue) {
    var foundValue = notFoundValue;
    this.forEach((v, k, c) => {
      if (predicate.call(context, v, k, c)) {
        foundValue = v;
        return false;
      }
    });
    return foundValue;
  }

  findKey(predicate, context) {
    var foundKey;
    this.forEach((v, k, c) => {
      if (predicate.call(context, v, k, c)) {
        foundKey = k;
        return false;
      }
    });
    return foundKey;
  }

  findLast(predicate, context, notFoundValue) {
    return this.reverse(true).find(predicate, context, notFoundValue);
  }

  findLastKey(predicate, context) {
    return this.reverse(true).findKey(predicate, context);
  }

  flip() {
    // flip() always returns a regular Sequence, even in subclasses.
    var flipSequence = Sequence.prototype.__makeSequence.call(this);
    flipSequence.length = this.length;
    var sequence = this;
    flipSequence.flip = () => sequence;
    flipSequence.__iterateUncached = (fn, reverse) =>
      sequence.__iterate((v, k, c) => fn(k, v, c) !== false, reverse);
    return flipSequence;
  }

  map(mapper, context) {
    var sequence = this;
    var mappedSequence = this.__makeSequence();
    mappedSequence.length = this.length;
    mappedSequence.__iterateUncached = (fn, reverse) =>
      sequence.__iterate((v, k, c) => fn(mapper.call(context, v, k, c), k, c) !== false, reverse);
    return mappedSequence;
  }

  filter(predicate, context) {
    return filterFactory(this, predicate, context, true, false);
  }

  slice(begin, end) {
    if (wholeSlice(begin, end, this.length)) {
      return this;
    }
    begin = resolveBegin(begin, this.length);
    end = resolveEnd(end, this.length);
    // begin or end will be NaN if they were provided as negative numbers and
    // this sequence's length is unknown. In that case, convert it to an
    // IndexedSequence by getting entries() and convert back to a sequence with
    // fromEntries(). IndexedSequence.prototype.slice will appropriately handle
    // this case.
    if (isNaN(begin) || isNaN(end)) {
      return this.entries().slice(begin, end).fromEntries();
    }
    return this.skip(begin).take(end - begin);
  }

  splice(index, removeNum, ...values) {
    if (removeNum === 0 && values.length === 0) {
      return this;
    }
    return this.slice(0, index).concat(values, this.slice(index + removeNum));
  }

  take(amount) {
    var iterations = 0;
    var sequence = this.takeWhile(() => iterations++ < amount);
    sequence.length = this.length && Math.min(this.length, amount);
    return sequence;
  }

  takeLast(amount, maintainIndices) {
    return this.reverse(maintainIndices).take(amount).reverse(maintainIndices);
  }

  takeWhile(predicate, context, maintainIndices) {
    var sequence = this;
    var takeSequence = this.__makeSequence();
    takeSequence.__iterateUncached = function(fn, reverse, flipIndices) {
      if (reverse) {
        // TODO: can we do a better job of this?
        return this.cacheResult().__iterate(fn, reverse, flipIndices);
      }
      var iterations = 0;
      sequence.__iterate((v, k, c) => {
        if (predicate.call(context, v, k, c) && fn(v, k, c) !== false) {
          iterations++;
        } else {
          return false;
        }
      }, reverse, flipIndices);
      return iterations;
    };
    return takeSequence;
  }

  takeUntil(predicate, context, maintainIndices) {
    return this.takeWhile(not(predicate), context, maintainIndices);
  }

  skip(amount, maintainIndices) {
    var iterations = 0;
    var sequence = this.skipWhile(() => iterations++ < amount, null, maintainIndices);
    sequence.length = this.length && Math.max(0, this.length - amount);
    return sequence;
  }

  skipLast(amount, maintainIndices) {
    return this.reverse(maintainIndices).skip(amount).reverse(maintainIndices);
  }

  skipWhile(predicate, context, maintainIndices) {
    var sequence = this;
    var skipSequence = this.__makeSequence();
    skipSequence.__iterateUncached = function(fn, reverse, flipIndices) {
      if (reverse) {
        // TODO: can we do a better job of this?
        return this.cacheResult().__iterate(fn, reverse, flipIndices);
      }
      var isSkipping = true;
      var iterations = 0;
      sequence.__iterate((v, k, c) => {
        if (!(isSkipping && (isSkipping = predicate.call(context, v, k, c)))) {
          if (fn(v, k, c) !== false) {
            iterations++;
          } else {
            return false;
          }
        }
      }, reverse, flipIndices);
      return iterations;
    };
    return skipSequence;
  }

  skipUntil(predicate, context, maintainIndices) {
    return this.skipWhile(not(predicate), context, maintainIndices);
  }

  cacheResult() {
    if (!this._cache) {
      var cache = [];
      var collection;
      var length = this.forEach((v, k, c) => {
        collection || (collection = c);
        cache.push([k, v]);
      });
      if (this.length == null) {
        this.length = length;
      }
      this._collection = collection;
      this._cache = cache;
    }
    return this;
  }

  // abstract __iterateUncached(fn, reverse)

  __iterate(fn, reverse, flipIndices) {
    if (!this._cache) {
      return this.__iterateUncached(fn, reverse, flipIndices);
    }
    var maxIndex = this.length - 1;
    var cache = this._cache;
    var c = this._collection;
    if (reverse) {
      for (var ii = cache.length - 1; ii >= 0; ii--) {
        var revEntry = cache[ii];
        if (fn(revEntry[1], flipIndices ? revEntry[0] : maxIndex - revEntry[0], c) === false) {
          break;
        }
      }
    } else {
      cache.every(flipIndices ?
        entry => fn(entry[1], maxIndex - entry[0], c) !== false :
        entry => fn(entry[1], entry[0], c) !== false
      );
    }
    return this.length;
  }

  __makeSequence() {
    var newSequence = Object.create(Sequence.prototype);
    newSequence.__parentSequence = this._parentSequence || this;
    return newSequence;
  }
}

Sequence.prototype.toJS = Sequence.prototype.toObject;


class IndexedSequence extends Sequence {

  toString() {
    return this.__toString('Seq [', ']');
  }

  toArray() {
    var array = new Array(this.length || 0);
    array.length = this.forEach((v, i) => { array[i] = v; });
    return array;
  }

  toVector() {
    // Use Late Binding here to solve the circular dependency.
    return require('./Vector').empty().merge(this);
  }

  join(separator) {
    separator = separator || ',';
    var string = '';
    var prevIndex = 0;
    this.forEach((v, i) => {
      var numSeparators = i - prevIndex;
      prevIndex = i;
      string += (numSeparators === 1 ? separator : repeatString(separator, numSeparators)) + v;
    });
    if (this.length && prevIndex < this.length - 1) {
      string += repeatString(separator, this.length - 1 - prevIndex);
    }
    return string;
  }

  concat(...values) {
    return new ConcatIndexedSequence(this, values);
  }

  reverse(maintainIndices) {
    return new ReversedIndexedSequence(this, maintainIndices);
  }

  fromEntries() {
    var newSequence = this.__makeSequence();
    newSequence.length = this.length;
    var sequence = this;
    newSequence.entries = () => sequence;
    newSequence.__iterateUncached = (fn, reverse, flipIndices) =>
      sequence.__iterate((entry, _, c) => fn(entry[1], entry[0], c), reverse, flipIndices);
    return newSequence;
  }

  // Overridden to supply undefined length
  values() {
    return new ValuesSequence(this);
  }

  filter(predicate, context, maintainIndices) {
    var filterSequence = filterFactory(this, predicate, context, maintainIndices, maintainIndices);
    if (maintainIndices) {
      filterSequence.length = this.length;
    }
    return filterSequence;
  }

  indexOf(searchValue) {
    return this.findIndex(value => value === searchValue);
  }

  findIndex(predicate, context) {
    var key = this.findKey(predicate, context);
    return key == null ? -1 : key;
  }

  lastIndexOf(searchValue) {
    return this.reverse(true).indexOf(searchValue);
  }

  findLastIndex(predicate, context) {
    return this.reverse(true).findIndex(predicate, context);
  }

  slice(begin, end, maintainIndices) {
    if (wholeSlice(begin, end, this.length)) {
      return this;
    }
    return new SliceIndexedSequence(this, begin, end, maintainIndices);
  }

  // Overrides to get length correct.
  takeWhile(predicate, context, maintainIndices) {
    var sequence = this;
    var takeSequence = this.__makeSequence();
    takeSequence.__iterateUncached = function(fn, reverse, flipIndices) {
      if (reverse) {
        // TODO: can we do a better job of this?
        return this.cacheResult().__iterate(fn, reverse, flipIndices);
      }
      var iterations = 0;
      // TODO: ensure didFinish is necessary here
      var didFinish = true;
      var length = sequence.__iterate((v, ii, c) => {
        if (predicate.call(context, v, ii, c) && fn(v, ii, c) !== false) {
          iterations = ii;
        } else {
          didFinish = false;
          return false;
        }
      }, reverse, flipIndices);
      return maintainIndices ? takeSequence.length : didFinish ? length : iterations + 1;
    };
    if (maintainIndices) {
      takeSequence.length = this.length;
    }
    return takeSequence;
  }

  skipWhile(predicate, context, maintainIndices) {
    var newSequence = this.__makeSequence();
    var sequence = this;
    newSequence.__iterateUncached = function(fn, reverse, flipIndices) {
      if (reverse) {
        return this.cacheResult().__iterate(fn, reverse, flipIndices)
      }
      var reversedIndices = sequence.__reversedIndices ^ flipIndices;
      var isSkipping = true;
      var indexOffset = 0;
      var length = sequence.__iterate((v, ii, c) => {
        if (isSkipping) {
          isSkipping = predicate.call(context, v, ii, c);
          if (!isSkipping) {
            indexOffset = ii;
          }
        }
        return isSkipping || fn(v, flipIndices || maintainIndices ? ii : ii - indexOffset, c) !== false;
      }, reverse, flipIndices);
      return maintainIndices ? length : reversedIndices ? indexOffset + 1 : length - indexOffset;
    };
    if (maintainIndices) {
      newSequence.length = this.length;
    }
    return newSequence;
  }

  // abstract __iterateUncached(fn, reverse, flipIndices)

  __makeSequence() {
    var newSequence = Object.create(IndexedSequence.prototype);
    newSequence.__reversedIndices = this.__reversedIndices;
    newSequence.__parentSequence = this._parentSequence || this;
    return newSequence;
  }
}

IndexedSequence.prototype.toJS = IndexedSequence.prototype.toArray;

IndexedSequence.prototype.__toStringMapper = quoteString;


/**
 * ValuesSequence re-indexes a sequence based on the iteration of values.
 */
class ValuesSequence extends IndexedSequence {
  constructor(sequence, length) {
    this.__parentSequence = sequence._parentSequence || sequence;
    this._sequence = sequence;
    this.length = length;
  }

  values() {
    return this;
  }

  __iterateUncached(fn, reverse, flipIndices) {
    if (flipIndices && this.length == null) {
      this.cacheResult();
    }
    var iterations = 0;
    var predicate;
    if (flipIndices) {
      var maxIndex = this.length - 1;
      predicate = (v, k, c) => fn(v, maxIndex - iterations++, c) !== false;
    } else {
      predicate = (v, k, c) => fn(v, iterations++, c) !== false;
    }
    this._sequence.__iterate(predicate, reverse); // intentionally do not pass flipIndices
    return iterations;
  }
}


class SliceIndexedSequence extends IndexedSequence {
  constructor(sequence, begin, end, maintainIndices) {
    this.__parentSequence = sequence._parentSequence || sequence;
    this.__reversedIndices = sequence.__reversedIndices;
    this._sequence = sequence;
    this._begin = begin;
    this._end = end;
    this._maintainIndices = maintainIndices;
    this.length = sequence.length && (maintainIndices ? sequence.length : resolveEnd(end, sequence.length) - resolveBegin(begin, sequence.length));
  }

  // Optimize the case of vector.slice(b, e).toVector()
  toVector() {
    var Vector = require('./Vector');
    var sequence = this.sequence;
    if (!this._maintainIndices && sequence instanceof Vector) {
      return sequence.setBounds(
        resolveBegin(this._begin, sequence.length),
        resolveEnd(this._end, sequence.length)
      );
    }
    return super.toVector();
  }

  __iterateUncached(fn, reverse, flipIndices) {
    if (reverse) {
      // TODO: reverse should be possible here.
      return this.cacheResult().__iterate(fn, reverse, flipIndices);
    }
    var reversedIndices = this.__reversedIndices ^ flipIndices;
    var sequence = this._sequence;
    if ((begin < 0 || end < 0 || reversedIndices) && sequence.length == null) {
      sequence.cacheResult();
    }
    var begin = resolveBegin(this._begin, sequence.length);
    var end = resolveEnd(this._end, sequence.length);
    var maintainIndices = this._maintainIndices;
    if (reversedIndices) {
      var newStart = sequence.length - end;
      end = sequence.length - begin;
      begin = newStart;
    }
    var length = sequence.__iterate((v, ii, c) =>
      !(ii >= begin && ii < end) || fn(v, maintainIndices ? ii : ii - begin, c) !== false,
      reverse, flipIndices
    );
    return this.length || (maintainIndices ? length : Math.max(0, length - begin));
  }
}


class ConcatIndexedSequence extends IndexedSequence {
  constructor(sequence, values) {
    this._sequences = [sequence].concat(values).map(value => Sequence(value));
    this.length = this._sequences.reduce(
      (sum, seq) => sum != null && seq.length != null ? sum + seq.length : undefined, 0
    );
    this._immutable = this._sequences.every(seq => !seq.isMutable());
  }

  isMutable() {
    return !this._immutable;
  }

  asImmutable() {
    this._sequences.map(seq => seq.asImmutable());
    return this;
  }

  __iterateUncached(fn, reverse, flipIndices) {
    if (flipIndices && !this.length) {
      // In order to reverse indices, first we must create a cached
      // representation. This ensures we will have the correct total length
      // so index reversal works as expected.
      this.cacheResult();
    }
    var shouldBreak;
    var iterations = 0;
    var maxIndex = flipIndices && this.length - 1;
    var maxSequencesIndex = this._sequences.length - 1;
    for (var ii = 0; ii <= maxSequencesIndex; ii++) {
      var sequence = this._sequences[reverse ? maxSequencesIndex - ii : ii];
      if (!(sequence instanceof IndexedSequence)) {
        sequence = sequence.values();
      }
      iterations += sequence.__iterate((v, index, c) => {
        index += iterations;
        if (fn(v, flipIndices ? maxIndex - index : index, c) === false) {
          shouldBreak = true;
          return false;
        }
      }, reverse); // intentionally do not pass flipIndices
      if (shouldBreak) {
        break;
      }
    }
    return iterations;
  }
}


class ReversedIndexedSequence extends IndexedSequence {
  constructor(sequence, maintainIndices) {
    if (sequence.length) {
      this.length = sequence.length;
    }
    this.__reversedIndices = !!(maintainIndices ^ sequence.__reversedIndices);
    this._sequence = sequence;
    this._maintainIndices = maintainIndices;
  }

  reverse(maintainIndices) {
    if (maintainIndices === this._maintainIndices) {
      return this._sequence;
    }
    return super.reverse(maintainIndices);
  }

  __iterateUncached(fn, reverse, flipIndices) {
    return this._sequence.__iterate(fn, !reverse, flipIndices ^ this._maintainIndices);
  }
}


class ArraySequence extends IndexedSequence {
  constructor(array, isImmutable) {
    this.length = array.length;
    this._array = array;
    this._immutable = !!isImmutable;
  }

  isMutable() {
    return !this._immutable;
  }

  asImmutable() {
    this._array = this._array.slice();
    this._immutable = true;
    return this;
  }

  cacheResult() {
    return this;
  }

  __iterate(fn, reverse, flipIndices) {
    var array = this._array;
    var maxIndex = array.length - 1;
    var lastIndex = -1;
    if (reverse) {
      for (var ii = maxIndex; ii >= 0; ii--) {
        if (array.hasOwnProperty(ii) &&
            fn(array[ii], flipIndices ? ii : maxIndex - ii, array) === false) {
          return lastIndex + 1;
        }
        lastIndex = ii;
      }
      return array.length;
    } else {
      var didFinish = this._array.every((value, index) => {
        if (fn(value, flipIndices ? maxIndex - index : index, array) === false) {
          return false;
        } else {
          lastIndex = index;
          return true;
        }
      });
      return didFinish ? array.length : lastIndex + 1;
    }
  }
}


class ObjectSequence extends Sequence {
  constructor(object, isImmutable) {
    this._object = object;
    this._immutable = !!isImmutable;
  }

  isMutable() {
    return !this._immutable;
  }

  asImmutable() {
    var prevObject = this._object;
    this._object = {};
    this.length = 0;
    this._immutable = true;
    for (var key in prevObject) if (prevObject.hasOwnProperty(key)) {
      this._object[key] = prevObject[key];
      this.length++;
    }
    return this;
  }

  cacheResult() {
    this.length = Object.keys(this._object).length;
    return this;
  }

  __iterate(fn, reverse) {
    var object = this._object;
    if (reverse) {
      var keys = Object.keys(object);
      for (var ii = keys.length - 1; ii >= 0; ii--) {
        if (fn(object[keys[ii]], keys[ii], object) === false) {
          return keys.length - ii + 1;
        }
      }
      return keys.length;
    } else {
      var iterations = 0;
      for (var key in object) if (object.hasOwnProperty(key)) {
        if (fn(object[key], key, object) === false) {
          break;
        }
        iterations++;
      }
      return iterations;
    }
  }
}

function wholeSlice(begin, end, length) {
  return (begin === 0 || (length != null && begin <= -length)) &&
    (end == null || (length != null && end >= length));
}

function resolveBegin(begin, length) {
  return begin < 0 ? Math.max(0, length + begin) : length ? Math.min(length, begin) : begin;
}

function resolveEnd(end, length) {
  return end == null ? length : end < 0 ? Math.max(0, length + end) : length ? Math.min(length, end) : end;
}

function keyMapper(v, k) {
  return k;
}

function entryMapper(v, k) {
  return [k, v];
}

/**
 * Sequence.prototype.filter and IndexedSequence.prototype.filter are so close
 * in behavior that it makes sense to build a factory with the few differences
 * encoded as booleans.
 */
function filterFactory(sequence, predicate, context, useKeys, maintainIndices) {
  var filterSequence = sequence.__makeSequence();
  filterSequence.__iterate = (fn, reverse, flipIndices) => {
    var iterations = 0;
    var length = sequence.__iterate((v, k, c) => {
      if (predicate.call(context, v, k, c)) {
        if (fn(v, useKeys ? k : iterations, c) !== false) {
          iterations++;
        } else {
          return false;
        }
      }
    }, reverse, flipIndices);
    return maintainIndices ? length : iterations;
  };
  return filterSequence;
}

function not(predicate) {
  return function() {
    return !predicate.apply(this, arguments);
  }
}

function quoteString(value) {
  return typeof value === 'string' ? JSON.stringify(value) : value;
}

function repeatString(string, times) {
  var repeated = '';
  while (times) {
    if (times & 1) {
      repeated += string;
    }
    if ((times >>= 1)) {
      string += string;
    }
  }
  return repeated;
}


exports.Sequence = Sequence;
exports.IndexedSequence = IndexedSequence;
