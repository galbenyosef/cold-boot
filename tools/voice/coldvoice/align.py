"""Text ↔ ASR alignment (the quality gate).

`align`, `_similar` and `norm_word` are copied from tities (`synth.py`, `words.py`)
unchanged in behaviour. A game line is generated whole (no look-ahead chunking),
so the look-ahead / untrusted-word machinery is kept but normally unused.
Added: digits in the ASR transcript are spelled out (Parakeet writes "32" for
"thirty-two"), and bracketed nonverbal tags ([sigh]) are not words.
"""

from __future__ import annotations

import difflib
import re
from dataclasses import dataclass

_NONWORD = re.compile(r"[^\w]")
_TAG = re.compile(r"\[[a-z-]+\]")


def norm_word(w: str) -> str:
    return _NONWORD.sub("", w.lower())


def text_words(text: str) -> list[str]:
    ws = [n for n in (norm_word(w) for w in _TAG.sub(" ", text).split()) if n]
    out: list[str] = []
    for n in ws:  # digits in the text are spoken as words too
        out += spell_digits(n) if n[0].isdigit() else _ASR_EQUIV.get(n, [n])
    return out


# ─────────────────────────────── numbers in the transcript → words

_ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
_TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()


def _num_words(n: int) -> list[str]:
    if n < 20:
        return [_ONES[n]]
    if n < 100:
        return [_TENS[n // 10]] + ([_ONES[n % 10]] if n % 10 else [])
    if n < 1000:
        return [_ONES[n // 100], "hundred"] + (_num_words(n % 100) if n % 100 else [])
    if n < 1_000_000:
        return _num_words(n // 1000) + ["thousand"] + (_num_words(n % 1000) if n % 1000 else [])
    return [str(n)]


def spell_digits(word: str) -> list[str]:
    """'32' → ['thirty', 'two']; '1.78' → ['one', 'point', 'seven', 'eight']; '00' → ['zero', 'zero']."""
    m = re.fullmatch(r"(\d+)(?:[.,](\d+))?(st|nd|rd|th|s)?", word)
    if not m:
        return [word]
    a, b, _suf = m.groups()
    out = [w for ch in a for w in _num_words(int(ch))] if a.startswith("0") and len(a) > 1 else _num_words(int(a))
    if b:
        out += ["point"] + [w for ch in b for w in _num_words(int(ch))]
    return out


# Parakeet spellings that are the same spoken words (not model errors)
_ASR_EQUIV = {
    "gonna": ["going", "to"], "wanna": ["want", "to"], "gotta": ["got", "to"], "ok": ["okay"],
    "t": ["tea"], "em": ["them"], "u": ["you"], "r": ["are"], "c": ["see"], "mr": ["mister"], "dr": ["doctor"],
    "mum": ["mum"], "mom": ["mum"], "alright": ["all", "right"],
}


def asr_tokens(raw_words: list[str]) -> list[str]:
    out: list[str] = []
    for w in raw_words:
        n = norm_word(w)
        if not n:
            continue
        out += spell_digits(n) if n[0].isdigit() else _ASR_EQUIV.get(n, [n])
    return out


# ─────────────────────────────── copied from tities synth.py

_HOMOPHONES = [{"two", "too", "to"}, {"four", "for"}, {"one", "won"}, {"eight", "ate"}, {"right", "write"},
               {"there", "their", "theyre"}, {"knows", "nose"}, {"no", "know"}, {"here", "hear"},
               {"whos", "whose"}, {"youre", "your"}, {"wear", "where"}, {"hole", "whole"}, {"sea", "see"}, {"rey", "ray"}]
_HOMO = {w: i for i, g in enumerate(_HOMOPHONES) for w in g}


def _similar(a: str, b: str, thr: float = 0.75) -> bool:
    if a == b or (a in _HOMO and _HOMO[a] == _HOMO.get(b)):
        return True  # ASR can't tell homophones apart: not a speech error
    return difflib.SequenceMatcher(a=a, b=b, autojunk=False).ratio() >= thr


@dataclass
class Alignment:
    map: list[int | None]  # ref word index → hyp word index (or None)
    missing: int  # trusted text words the audio does not contain
    extra: int  # words in the audio that are not in the text (insertions, half-words)

    @property
    def errors(self) -> int:
        return self.missing + self.extra


def align(ref: list[str], hyp: list[str], n_main: int | None = None,
          trusted: list[bool] | None = None) -> Alignment:
    """Align text words (main words, then look-ahead words) with ASR words.

    Errors are counted only where they end up in the kept audio: inside the
    main words and between them and the look-ahead (the audio is cut before
    the look-ahead). Untrusted words (rewritten by normalization, which ASR
    tends to hear as digits) never count as errors, nor do insertions next to
    them. ASR splitting or merging a word ("po nownie") is not an error."""
    n_main = len(ref) if n_main is None else n_main
    trusted = trusted if trusted is not None else [True] * n_main
    has_look = n_main < len(ref)
    m: list[int | None] = [None] * len(ref)
    missing = extra = 0

    def counts(i: int) -> bool:  # a ref word whose absence matters
        return i < n_main and trusted[i]

    def near_untrusted(i1: int, i2: int) -> bool:
        return any(not trusted[k] for k in range(max(0, i1 - 1), min(n_main, i2 + 1)))

    def kept(i1: int) -> bool:  # does an insertion before ref word i1 stay in the audio?
        return i1 <= n_main if has_look else True

    sm = difflib.SequenceMatcher(a=ref, b=hyp, autojunk=False)
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == "equal":
            for k in range(i2 - i1):
                m[i1 + k] = j1 + k
        elif op == "delete":
            missing += sum(counts(k) for k in range(i1, i2))
        elif op == "insert":
            if kept(i1) and not near_untrusted(i1, i1):
                extra += j2 - j1
        else:  # replace
            if i2 - i1 == j2 - j1:
                for k in range(i2 - i1):
                    m[i1 + k] = j1 + k
            if i1 >= n_main or not all(trusted[k] for k in range(i1, min(i2, n_main))):
                continue  # look-ahead, or a rewritten number heard as digits
            if _similar("".join(ref[i1:i2]), "".join(hyp[j1:j2]), 0.8):
                if i2 - i1 != j2 - j1:  # split/merged word: map the run's ends
                    m[i1] = j1
                    m[i2 - 1] = j2 - 1
                continue  # split/merged word or minor ASR spelling
            if i2 - i1 == j2 - j1:
                bad = sum(counts(i1 + k) and not _similar(ref[i1 + k], hyp[j1 + k]) for k in range(i2 - i1))
                missing += bad
                extra += bad
            else:
                missing += sum(counts(k) for k in range(i1, i2))
                extra += j2 - j1 if kept(i1) else 0
    return Alignment(m, missing, extra)
