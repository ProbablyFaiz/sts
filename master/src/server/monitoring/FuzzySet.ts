interface FuzzySet {
  get(candidate: string): Array<[number, string]> | null;

  get<DEFAULT>(
    candidate: string,
    def?: DEFAULT,
    minScore?: number,
  ): Array<[number, string]> | DEFAULT;

  add(value: string): false | undefined;

  length(): number;

  isEmpty(): boolean;

  values(): string[];
}

const FuzzySet = function (
  arr?,
  useLevenshtein?,
  gramSizeLower?,
  gramSizeUpper?,
): FuzzySet {
  const fuzzyset: any = {};

  // default options
  arr = arr || [];
  fuzzyset.gramSizeLower = gramSizeLower || 2;
  fuzzyset.gramSizeUpper = gramSizeUpper || 3;
  fuzzyset.useLevenshtein =
    typeof useLevenshtein !== "boolean" ? true : useLevenshtein;

  // define all the object functions and attributes
  fuzzyset.exactSet = {};
  fuzzyset.matchDict = {};
  fuzzyset.items = {};

  // helper functions
  const levenshtein = function (str1, str2) {
    const current = [];
    let prev, value;

    for (let i = 0; i <= str2.length; i++)
      for (let j = 0; j <= str1.length; j++) {
        if (i && j)
          if (str1.charAt(j - 1) === str2.charAt(i - 1)) value = prev;
          else value = Math.min(current[j], current[j - 1], prev) + 1;
        else value = i + j;

        prev = current[j];
        current[j] = value;
      }

    return current.pop();
  };

  // return an edit distance from 0 to 1
  const _distance = function (str1, str2) {
    if (str1 === null && str2 === null)
      throw "Trying to compare two null values";
    if (str1 === null || str2 === null) return 0;
    str1 = String(str1);
    str2 = String(str2);

    const distance = levenshtein(str1, str2);
    if (str1.length > str2.length) {
      return 1 - distance / str1.length;
    } else {
      return 1 - distance / str2.length;
    }
  };
  const _nonWordRe = /[^a-zA-Z0-9\u00C0-\u00FF, ]+/g;

  const _iterateGrams = function (value, gramSize) {
    let i;
    gramSize = gramSize || 2;
    let simplified = "-" + value.toLowerCase().replace(_nonWordRe, "") + "-";
    const lenDiff = gramSize - simplified.length,
      results = [];
    if (lenDiff > 0) {
      for (i = 0; i < lenDiff; ++i) {
        simplified += "-";
      }
    }
    for (i = 0; i < simplified.length - gramSize + 1; ++i) {
      results.push(simplified.slice(i, i + gramSize));
    }
    return results;
  };

  const _gramCounter = function (value, gramSize) {
    // return an object where key=gram, value=number of occurrences
    gramSize = gramSize || 2;
    const result = {},
      grams = _iterateGrams(value, gramSize);
    let i = 0;
    for (i; i < grams.length; ++i) {
      if (grams[i] in result) {
        result[grams[i]] += 1;
      } else {
        result[grams[i]] = 1;
      }
    }
    return result;
  };

  // the main functions
  fuzzyset.get = function (value, defaultValue, minMatchScore) {
    // check for value in set, returning defaultValue or null if none found
    if (minMatchScore === undefined) {
      minMatchScore = 0.33;
    }
    const result = this._get(value, minMatchScore);
    if (!result && typeof defaultValue !== "undefined") {
      return defaultValue;
    }
    return result;
  };

  fuzzyset._get = function (value, minMatchScore) {
    let results = [];
    // start with high gram size and if there are no results, go to lower gram sizes
    for (
      let gramSize = this.gramSizeUpper;
      gramSize >= this.gramSizeLower;
      --gramSize
    ) {
      results = this.__get(value, gramSize, minMatchScore);
      if (results && results.length > 0) {
        return results;
      }
    }
    return null;
  };

  fuzzyset.__get = function (value, gramSize, minMatchScore) {
    let newResults;
    const normalizedValue = this._normalizeStr(value),
      matches = {},
      gramCounts = _gramCounter(normalizedValue, gramSize),
      items = this.items[gramSize];
    let sumOfSquareGramCounts = 0,
      gram,
      gramCount,
      i,
      index,
      otherGramCount;

    for (gram in gramCounts) {
      gramCount = gramCounts[gram];
      sumOfSquareGramCounts += Math.pow(gramCount, 2);
      if (gram in this.matchDict) {
        for (i = 0; i < this.matchDict[gram].length; ++i) {
          index = this.matchDict[gram][i][0];
          otherGramCount = this.matchDict[gram][i][1];
          if (index in matches) {
            matches[index] += gramCount * otherGramCount;
          } else {
            matches[index] = gramCount * otherGramCount;
          }
        }
      }
    }

    function isEmptyObject(obj) {
      for (let prop in obj) {
        if (obj.hasOwnProperty(prop)) return false;
      }
      return true;
    }

    if (isEmptyObject(matches)) {
      return null;
    }

    const vectorNormal = Math.sqrt(sumOfSquareGramCounts);
    let results = [],
      matchScore;
    // build a results list of [score, str]
    for (let matchIndex in matches) {
      matchScore = matches[matchIndex];
      results.push([
        matchScore / (vectorNormal * items[matchIndex][0]),
        items[matchIndex][1],
      ]);
    }
    const sortDescending = function (a, b) {
      if (a[0] < b[0]) {
        return 1;
      } else if (a[0] > b[0]) {
        return -1;
      } else {
        return 0;
      }
    };
    results.sort(sortDescending);
    if (this.useLevenshtein) {
      newResults = [];
      let endIndex = Math.min(50, results.length);
      // truncate somewhat arbitrarily to 50
      for (let i = 0; i < endIndex; ++i) {
        newResults.push([
          _distance(results[i][1], normalizedValue),
          results[i][1],
        ]);
      }
      results = newResults;
      results.sort(sortDescending);
    }
    newResults = [];
    results.forEach(
      function (scoreWordPair) {
        if (scoreWordPair[0] >= minMatchScore) {
          newResults.push([scoreWordPair[0], this.exactSet[scoreWordPair[1]]]);
        }
      }.bind(this),
    );
    return newResults;
  };

  fuzzyset.add = function (value) {
    const normalizedValue = this._normalizeStr(value);
    if (normalizedValue in this.exactSet) {
      return false;
    }

    let i = this.gramSizeLower;
    for (i; i < this.gramSizeUpper + 1; ++i) {
      this._add(value, i);
    }
  };

  fuzzyset._add = function (value, gramSize) {
    const normalizedValue = this._normalizeStr(value),
      items = this.items[gramSize] || [],
      index = items.length;

    items.push(0);
    const gramCounts = _gramCounter(normalizedValue, gramSize);
    let sumOfSquareGramCounts = 0,
      gram,
      gramCount;
    for (gram in gramCounts) {
      gramCount = gramCounts[gram];
      sumOfSquareGramCounts += Math.pow(gramCount, 2);
      if (gram in this.matchDict) {
        this.matchDict[gram].push([index, gramCount]);
      } else {
        this.matchDict[gram] = [[index, gramCount]];
      }
    }
    const vectorNormal = Math.sqrt(sumOfSquareGramCounts);
    items[index] = [vectorNormal, normalizedValue];
    this.items[gramSize] = items;
    this.exactSet[normalizedValue] = value;
  };

  fuzzyset._normalizeStr = function (str) {
    if (Object.prototype.toString.call(str) !== "[object String]")
      throw "Must use a string as argument to FuzzySet functions";
    return str.toLowerCase();
  };

  // return length of items in set
  fuzzyset.length = function () {
    let count = 0,
      prop;
    for (prop in this.exactSet) {
      if (this.exactSet.hasOwnProperty(prop)) {
        count += 1;
      }
    }
    return count;
  };

  // return is set is empty
  fuzzyset.isEmpty = function () {
    for (let prop in this.exactSet) {
      if (this.exactSet.hasOwnProperty(prop)) {
        return false;
      }
    }
    return true;
  };

  // return list of values loaded into set
  fuzzyset.values = function () {
    const values = [];
    let prop;
    for (prop in this.exactSet) {
      if (this.exactSet.hasOwnProperty(prop)) {
        values.push(this.exactSet[prop]);
      }
    }
    return values;
  };

  // initialization
  let i = fuzzyset.gramSizeLower;
  for (i; i < fuzzyset.gramSizeUpper + 1; ++i) {
    fuzzyset.items[i] = [];
  }
  // add all the items to the set
  for (i = 0; i < arr.length; ++i) {
    fuzzyset.add(arr[i]);
  }

  return fuzzyset;
};

export default FuzzySet;
