import { describe, expect, it } from "vitest";
import { wordConfidences } from "./ocr";

describe("wordConfidences", () => {
  it("averages words and skips layout rows and empty text", () => {
    const tsv = [
      "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
      "1\t1\t0\t0\t0\t0\t0\t0\t1275\t1650\t-1\t",
      "5\t1\t1\t1\t1\t1\t150\t150\t200\t30\t96.5\tINVOICE",
      "5\t1\t1\t1\t1\t2\t360\t150\t180\t30\t88.5\tINV-2042",
      "5\t1\t1\t1\t1\t3\t560\t150\t10\t30\t95\t ",
      "",
    ].join("\n");
    expect(wordConfidences(tsv)).toEqual({ total: 185, words: 2 });
  });

  it("returns no words for empty output", () => {
    expect(wordConfidences("")).toEqual({ total: 0, words: 0 });
  });
});
