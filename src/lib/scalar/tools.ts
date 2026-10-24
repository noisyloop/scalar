type Sev = "high" | "med";

// `named` is how a deliverable has to refer to the finding for the grader to count it.
const RULES: { re: RegExp; sev: Sev; msg: string; named: RegExp }[] = [
  {
    re: /AKIA[0-9A-Z]{16}/,
    sev: "high",
    msg: "looks like an AWS access key id",
    named: /AKIA|access key|aws|credential|secret/i,
  },
  {
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    sev: "high",
    msg: "private key material",
    named: /private key/i,
  },
  {
    re: /innerHTML\s*=/,
    sev: "high",
    msg: "innerHTML assignment (markup injection)",
    named: /innerHTML|xss|markup injection/i,
  },
  {
    re: /dangerouslySetInnerHTML/,
    sev: "high",
    msg: "unsanitized HTML render",
    named: /dangerouslySetInnerHTML|xss|unsanitized/i,
  },
  {
    re: /document\.write\s*\(/,
    sev: "high",
    msg: "document.write",
    named: /document\.write|xss/i,
  },
  {
    re: /\beval\s*\(/,
    sev: "high",
    msg: "eval",
    named: /\beval\b|code injection/i,
  },
  {
    re: /SELECT[\s\S]{0,80}\+/,
    sev: "high",
    msg: "SQL assembled with string concatenation",
    named: /sql|concat/i,
  },
  {
    re: /createHash\(\s*["']md5["']\s*\)/i,
    sev: "high",
    msg: "MD5 used as a cryptographic hash",
    named: /md5/i,
  },
  {
    re: /createHash\(\s*["']sha1["']\s*\)/i,
    sev: "med",
    msg: "SHA-1 used as a cryptographic hash",
    named: /sha-?1/i,
  },
  {
    re: /password\s*[:=]\s*["'][^"']+["']/i,
    sev: "high",
    msg: "hardcoded password",
    named: /password/i,
  },
  {
    re: /child_process|execSync\s*\(/,
    sev: "high",
    msg: "shell execution",
    named: /shell|exec|command injection/i,
  },
  {
    re: /log(?:s|ging)? the (full )?body/i,
    sev: "high",
    msg: "full request body is logged",
    named: /log/i,
  },
  {
    re: /signature[^.]{0,80}(optional|only if)/i,
    sev: "high",
    msg: "signature verification is conditional",
    named: /signature/i,
  },
  {
    re: /not dedup/i,
    sev: "med",
    msg: "retries are not deduplicated",
    named: /dedup|replay|idempot/i,
  },
  {
    re: /credit the user id in the json/i,
    sev: "high",
    msg: "trusts a user id supplied in the body",
    named: /user ?id|body/i,
  },
  {
    re: /endpoint is HTTP/i,
    sev: "med",
    msg: "cleartext HTTP on the hop",
    named: /http\b|cleartext|tls/i,
  },
  {
    re: /card metadata|primary account|\bPAN\b/i,
    sev: "high",
    msg: "payment card data in scope",
    named: /card|pan\b|pci/i,
  },
];

export type ScanHit = { sev: Sev; line: number; msg: string; named: RegExp };

export function scanHits(artifact: string): ScanHit[] {
  const lines = artifact.trim().split("\n");
  const hits: ScanHit[] = [];
  for (const rule of RULES) {
    const index = lines.findIndex((line) => rule.re.test(line));
    if (index >= 0)
      hits.push({
        sev: rule.sev,
        line: index + 1,
        msg: rule.msg,
        named: rule.named,
      });
  }
  return hits;
}

export function scanArtifact(artifact: string): string {
  if (!artifact.trim()) return "No artifact attached. There is nothing to scan.";
  const hits = scanHits(artifact);
  if (!hits.length) return "Scan finished. No rule matched.";
  const high = hits.filter((hit) => hit.sev === "high").length;
  const med = hits.length - high;
  return `${high} high, ${med} med\n${hits.map((hit) => `${hit.sev}  L${hit.line}  ${hit.msg}`).join("\n")}`;
}

class ExprParser {
  private i = 0;

  constructor(private readonly s: string) {}

  done() {
    return this.i >= this.s.length;
  }

  parse() {
    const value = this.expr();
    if (!this.done()) throw new Error("trailing");
    return value;
  }

  private expr(): number {
    let value = this.term();
    while (this.s[this.i] === "+" || this.s[this.i] === "-") {
      const op = this.s[this.i++];
      const right = this.term();
      value = op === "+" ? value + right : value - right;
    }
    return value;
  }

  private term(): number {
    let value = this.unary();
    while (this.s[this.i] === "*" || this.s[this.i] === "/" || this.s[this.i] === "%") {
      const op = this.s[this.i++];
      const right = this.unary();
      if ((op === "/" || op === "%") && right === 0) throw new Error("div0");
      value = op === "*" ? value * right : op === "/" ? value / right : value % right;
    }
    return value;
  }

  private unary(): number {
    if (this.s[this.i] === "-") {
      this.i++;
      return -this.unary();
    }
    if (this.s[this.i] === "+") {
      this.i++;
      return this.unary();
    }
    return this.primary();
  }

  private primary(): number {
    if (this.s[this.i] === "(") {
      this.i++;
      const value = this.expr();
      if (this.s[this.i] !== ")") throw new Error("paren");
      this.i++;
      return value;
    }
    const start = this.i;
    while (/[0-9.]/.test(this.s[this.i] ?? "")) this.i++;
    if (start === this.i) throw new Error("num");
    const value = Number(this.s.slice(start, this.i));
    if (!Number.isFinite(value)) throw new Error("num");
    return value;
  }
}

export function arithmetic(expr: string): string {
  const src = expr.replace(/\s+/g, "");
  if (!src || src.length > 80) return "rejected: empty or too long";
  if (!/^[0-9+\-*/%.()]+$/.test(src)) return "rejected: only digits and + - * / % ( )";
  try {
    const value = new ExprParser(src).parse();
    if (!Number.isFinite(value)) return "not a finite number";
    const rounded = Math.round(value * 10000) / 10000;
    return `${src} = ${rounded}`;
  } catch {
    return "could not evaluate";
  }
}

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const PITCH: Record<string, number> = {};
NAMES.forEach((name, i) => {
  PITCH[name] = i;
});

const FLATS: Record<string, string> = {
  Cb: "B",
  Db: "C#",
  Eb: "D#",
  Fb: "E",
  Gb: "F#",
  Ab: "G#",
  Bb: "A#",
};

type Quality = "maj" | "min" | "dim" | "aug" | "7";

function parseChord(raw: string): { name: string; root: number; quality: Quality } | null {
  const match = raw.trim().match(/^([A-G](?:#|b)?)(.*)$/);
  if (!match) return null;
  let rootName = match[1];
  if (rootName.endsWith("b")) rootName = FLATS[rootName] ?? rootName;
  const root = PITCH[rootName];
  if (root === undefined) return null;
  const rest = match[2].toLowerCase();
  let quality: Quality = "maj";
  // "maj7" starts with "m" too, so it has to be ruled out before minor.
  if (rest.startsWith("maj")) quality = "maj";
  else if (rest.startsWith("dim") || rest.startsWith("o")) quality = "dim";
  else if (rest.startsWith("aug") || rest.startsWith("+")) quality = "aug";
  else if (rest.startsWith("m") || rest.startsWith("-")) quality = "min";
  else if (rest.includes("7")) quality = "7";
  return { name: raw.trim(), root, quality };
}

function intervalName(semitones: number): string {
  const names = [
    "unison",
    "minor second",
    "major second",
    "minor third",
    "major third",
    "perfect fourth",
    "tritone",
    "perfect fifth",
    "minor sixth",
    "major sixth",
    "minor seventh",
    "major seventh",
  ];
  return names[semitones] ?? "octave";
}

export function musicCheck(progression: string): string {
  const tokens = progression
    .replace(/\|/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const chords = tokens.map(parseChord).filter((chord) => chord !== null);
  if (chords.length < 2) return "Need at least two chords, like: Am F C G";

  const lines = [`Parsed ${chords.map((chord) => chord.name).join(" ")}`];
  const parallels: string[] = [];
  for (let i = 1; i < chords.length; i++) {
    const prev = chords[i - 1];
    const next = chords[i];
    const up = (next.root - prev.root + 12) % 12;
    if (
      (up === 7 || up === 5) &&
      prev.quality === next.quality &&
      (prev.quality === "maj" || prev.quality === "min")
    ) {
      parallels.push(
        `parallel fifth motion ${prev.name} → ${next.name} (${intervalName(up)}, both ${prev.quality})`,
      );
    }
  }
  if (parallels.length) lines.push(...parallels.map((line) => `parallel  ${line}`));
  else lines.push("parallel  none at a perfect fifth between equal qualities");

  const tonic = chords[0];
  const minorKey = tonic.quality === "min";
  const key = `${NAMES[tonic.root]} ${minorKey ? "minor" : "major"}`;
  lines.push(`key  heard as ${key} (first chord is home)`);

  for (let i = 0; i + 4 <= chords.length; i++) {
    const window = chords.slice(i, i + 4);
    const minors = window.filter((chord) => chord.quality === "min");
    const majors = window.filter((chord) => chord.quality === "maj");
    if (minors.length !== 1 || majors.length !== 3) continue;
    const vi = minors[0].root;
    const want = [3, 8, 10].map((step) => (vi + step) % 12).sort();
    const got = majors.map((chord) => chord.root).sort();
    if (want.every((root, index) => root === got[index])) {
      lines.push(
        `cadence  ${window.map((chord) => chord.name).join(" ")} is the axis loop. It reads bright and familiar, not uneasy.`,
      );
      break;
    }
  }

  const last = chords[chords.length - 1];
  const fromTonic = (last.root - tonic.root + 12) % 12;
  if (last.quality === "maj" || last.quality === "7") {
    if (fromTonic === 7) {
      lines.push(
        `cadence  ends on ${last.name}, the major dominant. It pulls hard and neatly back to ${tonic.name}.`,
      );
    } else if (minorKey && fromTonic === 10) {
      lines.push(
        `cadence  ends on ${last.name}, the major bVII. It is a bright, triumphant rock landing.`,
      );
    }
  }

  const sub = minorKey
    ? {
        name: `${NAMES[(tonic.root + 5) % 12]}m`,
        why: `It is iv, stays in ${key}, and lands less neatly.`,
      }
    : {
        name: `${NAMES[(tonic.root + 9) % 12]}m`,
        why: `It is vi, a deceptive landing that stays in ${key}.`,
      };
  if (last.root === (minorKey ? (tonic.root + 5) % 12 : (tonic.root + 9) % 12)) {
    lines.push(`substitution  replace ${chords[1].name} with ${sub.name}. ${sub.why}`);
  } else {
    lines.push(`substitution  replace the final ${last.name} with ${sub.name}. ${sub.why}`);
  }
  return lines.join("\n");
}

export function regexScan(artifact: string, pattern: string, flags: string): string {
  const source = pattern.slice(0, 40);
  if (!source) return "rejected: empty pattern";
  if (/[{(\\?]/.test(source) || (source.match(/[+*]/g)?.length ?? 0) > 2) {
    return "rejected: pattern is too open";
  }
  const flag = flags.replace(/[^gim]/g, "").slice(0, 3);
  let re: RegExp;
  try {
    re = new RegExp(source, flag);
  } catch {
    return "rejected: invalid pattern";
  }
  const hits: string[] = [];
  const lines = artifact.slice(0, 4000).split("\n");
  for (let i = 0; i < lines.length && hits.length < 8; i++) {
    if (re.test(lines[i])) hits.push(`${i + 1}: ${lines[i].trim().slice(0, 120)}`);
    re.lastIndex = 0;
  }
  if (!hits.length) return `no matches for /${source}/${flag}`;
  return hits.join("\n");
}

export function runTool(name: string, args: Record<string, unknown>, artifact: string): string {
  if (name === "scan_artifact") return scanArtifact(artifact);
  if (name === "arithmetic") return arithmetic(String(args.expr ?? ""));
  if (name === "music_check") {
    const progression = String(args.progression ?? "").trim() || artifact;
    return musicCheck(progression);
  }
  if (name === "regex_scan") {
    return regexScan(artifact, String(args.pattern ?? ""), String(args.flags ?? ""));
  }
  return `unknown tool: ${name}`;
}
