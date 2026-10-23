type Sev = "high" | "med";

const RULES: { re: RegExp; sev: Sev; msg: string }[] = [
  { re: /AKIA[0-9A-Z]{16}/, sev: "high", msg: "looks like an AWS access key id" },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, sev: "high", msg: "private key material" },
  { re: /innerHTML\s*=/, sev: "high", msg: "innerHTML assignment (markup injection)" },
  { re: /dangerouslySetInnerHTML/, sev: "high", msg: "unsanitized HTML render" },
  { re: /document\.write\s*\(/, sev: "high", msg: "document.write" },
  { re: /\beval\s*\(/, sev: "high", msg: "eval" },
  { re: /SELECT[\s\S]{0,80}\+/, sev: "high", msg: "SQL assembled with string concatenation" },
  { re: /createHash\(\s*["']md5["']\s*\)/i, sev: "high", msg: "MD5 used as a cryptographic hash" },
  { re: /createHash\(\s*["']sha1["']\s*\)/i, sev: "med", msg: "SHA-1 used as a cryptographic hash" },
  { re: /password\s*[:=]\s*["'][^"']+["']/i, sev: "high", msg: "hardcoded password" },
  { re: /child_process|execSync\s*\(/, sev: "high", msg: "shell execution" },
  { re: /log(?:s|ging)? the (full )?body/i, sev: "high", msg: "full request body is logged" },
  {
    re: /signature[^.]{0,80}(optional|only if)/i,
    sev: "high",
    msg: "signature verification is conditional",
  },
  { re: /not dedup/i, sev: "med", msg: "retries are not deduplicated" },
  {
    re: /credit the user id in the json/i,
    sev: "high",
    msg: "trusts a user id supplied in the body",
  },
  { re: /endpoint is HTTP/i, sev: "med", msg: "cleartext HTTP on the hop" },
  { re: /card metadata|primary account|\bPAN\b/i, sev: "high", msg: "payment card data in scope" },
];

export function scanArtifact(artifact: string): string {
  const text = artifact.trim();
  if (!text) return "No artifact attached. There is nothing to scan.";
  const lines = text.split("\n");
  const hits: string[] = [];
  for (const rule of RULES) {
    for (let i = 0; i < lines.length; i++) {
      if (rule.re.test(lines[i])) {
        hits.push(`${rule.sev}  L${i + 1}  ${rule.msg}`);
        break;
      }
    }
  }
  if (!hits.length) return "Scan finished. No rule matched.";
  const high = hits.filter((h) => h.startsWith("high")).length;
  const med = hits.length - high;
  return `${high} high, ${med} med\n${hits.join("\n")}`;
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
    while ("*/%".includes(this.s[this.i] ?? "")) {
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

const PITCH: Record<string, number> = {};
["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"].forEach((name, i) => {
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
  if (rest.startsWith("dim") || rest.startsWith("o")) quality = "dim";
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
    if ((up === 7 || up === 5) && prev.quality === next.quality && (prev.quality === "maj" || prev.quality === "min")) {
      parallels.push(
        `parallel fifth motion ${prev.name} → ${next.name} (${intervalName(up)}, both ${prev.quality})`,
      );
    }
  }
  if (parallels.length) lines.push(...parallels.map((line) => `parallel  ${line}`));
  else lines.push("parallel  none at a perfect fifth between equal qualities");

  const joined = chords.map((chord) => chord.name).join(" ");
  if (/^Am F C G\b/.test(joined)) {
    lines.push("cadence  Am F C G is the axis loop. It reads bright and familiar, not uneasy.");
  }
  const last = chords[chords.length - 1];
  if (last.name === "G" || last.name === "Gmaj") {
    lines.push(
      "cadence  ends on G, a major dominant. That landing is neat and pulls toward a triumphant Am.",
    );
  }
  lines.push("substitution  replace the final G with Dm. It stays in A natural minor and lands less neatly.");
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

export function runTool(
  name: string,
  args: Record<string, unknown>,
  artifact: string,
): string {
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
