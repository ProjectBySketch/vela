/*
 * velac - the Vela compiler.
 *
 * Vela source is parsed and lowered to portable C11; the host C compiler
 * (clang on macOS and iOS, cc on Debian) then turns that into a native
 * binary. Every Vela value is a vela_value, whose behaviour lives in
 * runtime/vela_runtime.c.
 */

#if !defined(_POSIX_C_SOURCE)
#define _POSIX_C_SOURCE 200809L /* readlink, under a strict -std=c11 */
#endif

#include <ctype.h>
#include <errno.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#ifdef __APPLE__
#include <mach-o/dyld.h>
#endif

#ifndef VELA_VERSION
#define VELA_VERSION "0.1.0"
#endif

#if defined(__GNUC__) || defined(__clang__)
#define VELA_NORETURN __attribute__((noreturn))
#else
#define VELA_NORETURN
#endif

/* ------------------------------------------------------------------ */
/* small utilities                                                     */
/* ------------------------------------------------------------------ */

static void *xrealloc(void *p, size_t n) {
  void *q = realloc(p, n);
  if (q == NULL) {
    fputs("velac: out of memory\n", stderr);
    exit(1);
  }
  return q;
}

static void *xcalloc(size_t n, size_t size) {
  void *p = calloc(n, size);
  if (p == NULL) {
    fputs("velac: out of memory\n", stderr);
    exit(1);
  }
  return p;
}

typedef struct {
  char *data;
  size_t len;
  size_t cap;
} Buf;

static void buf_reserve(Buf *b, size_t extra) {
  if (b->len + extra + 1 <= b->cap) {
    return;
  }
  size_t cap = b->cap ? b->cap : 256;
  while (cap < b->len + extra + 1) {
    cap *= 2;
  }
  b->data = (char *)xrealloc(b->data, cap);
  b->cap = cap;
  b->data[b->len] = '\0';
}

static void buf_putc(Buf *b, char c) {
  buf_reserve(b, 1);
  b->data[b->len++] = c;
  b->data[b->len] = '\0';
}

static void buf_puts(Buf *b, const char *s) {
  size_t n = strlen(s);
  buf_reserve(b, n);
  memcpy(b->data + b->len, s, n);
  b->len += n;
  b->data[b->len] = '\0';
}

static void buf_printf(Buf *b, const char *fmt, ...) {
  va_list ap;
  va_start(ap, fmt);
  va_list ap2;
  va_copy(ap2, ap);
  int n = vsnprintf(NULL, 0, fmt, ap);
  va_end(ap);
  if (n > 0) {
    buf_reserve(b, (size_t)n);
    vsnprintf(b->data + b->len, (size_t)n + 1, fmt, ap2);
    b->len += (size_t)n;
  }
  va_end(ap2);
}

static char *xstrdup(const char *s) {
  size_t n = strlen(s);
  char *p = (char *)xrealloc(NULL, n + 1);
  memcpy(p, s, n + 1);
  return p;
}

static VELA_NORETURN void fail_cli(const char *fmt, ...) {
  va_list ap;
  va_start(ap, fmt);
  fputs("velac: ", stderr);
  vfprintf(stderr, fmt, ap);
  fputc('\n', stderr);
  va_end(ap);
  exit(1);
}

static VELA_NORETURN void fail_at(const char *path, int line, const char *fmt, ...) {
  va_list ap;
  va_start(ap, fmt);
  fprintf(stderr, "%s:%d: error: ", path, line);
  vfprintf(stderr, fmt, ap);
  fputc('\n', stderr);
  va_end(ap);
  exit(1);
}

/* ------------------------------------------------------------------ */
/* lexer                                                               */
/* ------------------------------------------------------------------ */

typedef enum {
  TK_EOF,
  TK_IDENT,
  TK_NUMBER,
  TK_STRING,

  TK_LET,
  TK_MUT,
  TK_FN,
  TK_IF,
  TK_ELSE,
  TK_WHILE,
  TK_FOR,
  TK_IN,
  TK_RETURN,
  TK_BREAK,
  TK_CONTINUE,
  TK_TRUE,
  TK_FALSE,
  TK_NIL,

  TK_LPAREN,
  TK_RPAREN,
  TK_LBRACE,
  TK_RBRACE,
  TK_LBRACKET,
  TK_RBRACKET,
  TK_COMMA,

  TK_PLUS,
  TK_MINUS,
  TK_STAR,
  TK_SLASH,
  TK_PERCENT,

  TK_ASSIGN,
  TK_PLUS_EQ,
  TK_MINUS_EQ,
  TK_STAR_EQ,
  TK_SLASH_EQ,

  TK_EQ,
  TK_NE,
  TK_LT,
  TK_LE,
  TK_GT,
  TK_GE,

  TK_AND,
  TK_OR,
  TK_NOT
} TokType;

typedef struct {
  TokType type;
  const char *start;
  int len;
  double num;
  char *str; /* decoded text for TK_STRING, else NULL */
  int line;
} Token;

typedef struct {
  Token *items;
  size_t count;
  size_t cap;
} TokenList;

static void tokens_push(TokenList *tl, Token t) {
  if (tl->count == tl->cap) {
    tl->cap = tl->cap ? tl->cap * 2 : 128;
    tl->items = (Token *)xrealloc(tl->items, tl->cap * sizeof(Token));
  }
  tl->items[tl->count++] = t;
}

static int is_ident_start(int c) { return isalpha(c) || c == '_'; }
static int is_ident_char(int c) { return isalnum(c) || c == '_'; }

static TokType keyword_type(const char *s, int len) {
  static const struct {
    const char *name;
    TokType type;
  } kws[] = {
      {"let", TK_LET},       {"mut", TK_MUT},       {"fn", TK_FN},
      {"if", TK_IF},         {"else", TK_ELSE},     {"while", TK_WHILE},
      {"for", TK_FOR},       {"in", TK_IN},         {"return", TK_RETURN},
      {"break", TK_BREAK},   {"continue", TK_CONTINUE}, {"true", TK_TRUE},
      {"false", TK_FALSE},   {"nil", TK_NIL},
  };
  for (size_t i = 0; i < sizeof(kws) / sizeof(kws[0]); i++) {
    if ((int)strlen(kws[i].name) == len && memcmp(kws[i].name, s, (size_t)len) == 0) {
      return kws[i].type;
    }
  }
  return TK_IDENT;
}

static void lex(const char *src, const char *path, TokenList *out) {
  size_t i = 0;
  size_t n = strlen(src);
  int line = 1;

  while (i < n) {
    char c = src[i];
    char d = (i + 1 < n) ? src[i + 1] : '\0';

    if (c == '\n') {
      line++;
      i++;
      continue;
    }
    if (c == ' ' || c == '\t' || c == '\r' || c == ';') {
      i++;
      continue;
    }
    if (c == '#') {
      while (i < n && src[i] != '\n') i++;
      continue;
    }
    if (c == '/' && d == '/') {
      while (i < n && src[i] != '\n') i++;
      continue;
    }
    if (c == '/' && d == '*') {
      i += 2;
      while (i < n && !(src[i] == '*' && i + 1 < n && src[i + 1] == '/')) {
        if (src[i] == '\n') line++;
        i++;
      }
      if (i >= n) fail_at(path, line, "unterminated block comment");
      i += 2;
      continue;
    }

    if (is_ident_start((unsigned char)c)) {
      size_t start = i;
      Token t;
      memset(&t, 0, sizeof t);
      while (i < n && is_ident_char((unsigned char)src[i])) i++;
      t.type = keyword_type(src + start, (int)(i - start));
      t.start = src + start;
      t.len = (int)(i - start);
      t.line = line;
      tokens_push(out, t);
      continue;
    }

    if (isdigit((unsigned char)c)) {
      size_t start = i;
      Token t;
      memset(&t, 0, sizeof t);
      while (i < n && isdigit((unsigned char)src[i])) i++;
      if (i + 1 < n && src[i] == '.' && isdigit((unsigned char)src[i + 1])) {
        i++;
        while (i < n && isdigit((unsigned char)src[i])) i++;
      }
      t.type = TK_NUMBER;
      t.start = src + start;
      t.len = (int)(i - start);
      t.line = line;
      {
        size_t len = i - start;
        char tmp[64];
        if (len < sizeof tmp) {
          memcpy(tmp, src + start, len);
          tmp[len] = '\0';
          t.num = strtod(tmp, NULL);
        }
      }
      tokens_push(out, t);
      continue;
    }

    if (c == '"') {
      Buf sb = {0};
      Token t;
      memset(&t, 0, sizeof t);
      t.type = TK_STRING;
      t.line = line;
      i++;
      while (i < n && src[i] != '"') {
        char ch = src[i];
        if (ch == '\\' && i + 1 < n) {
          char e = src[i + 1];
          i += 2;
          switch (e) {
            case 'n': buf_putc(&sb, '\n'); break;
            case 't': buf_putc(&sb, '\t'); break;
            case 'r': buf_putc(&sb, '\r'); break;
            case '\\': buf_putc(&sb, '\\'); break;
            case '"': buf_putc(&sb, '"'); break;
            default:
              buf_putc(&sb, '\\');
              buf_putc(&sb, e);
              break;
          }
        } else {
          if (ch == '\n') line++;
          buf_putc(&sb, ch);
          i++;
        }
      }
      if (i >= n) fail_at(path, line, "unterminated string");
      i++; /* closing quote */
      t.str = sb.data ? sb.data : xstrdup("");
      t.start = src;
      t.len = 0;
      tokens_push(out, t);
      continue;
    }

    {
      Token t;
      int adv = 1;
      memset(&t, 0, sizeof t);
      t.start = src + i;
      t.line = line;

      switch (c) {
        case '(': t.type = TK_LPAREN; break;
        case ')': t.type = TK_RPAREN; break;
        case '{': t.type = TK_LBRACE; break;
        case '}': t.type = TK_RBRACE; break;
        case '[': t.type = TK_LBRACKET; break;
        case ']': t.type = TK_RBRACKET; break;
        case ',': t.type = TK_COMMA; break;
        case '%': t.type = TK_PERCENT; break;
        case '+':
          if (d == '=') { t.type = TK_PLUS_EQ; adv = 2; } else { t.type = TK_PLUS; }
          break;
        case '-':
          if (d == '=') { t.type = TK_MINUS_EQ; adv = 2; } else { t.type = TK_MINUS; }
          break;
        case '*':
          if (d == '=') { t.type = TK_STAR_EQ; adv = 2; } else { t.type = TK_STAR; }
          break;
        case '/':
          if (d == '=') { t.type = TK_SLASH_EQ; adv = 2; } else { t.type = TK_SLASH; }
          break;
        case '=':
          if (d == '=') { t.type = TK_EQ; adv = 2; } else { t.type = TK_ASSIGN; }
          break;
        case '!':
          if (d == '=') { t.type = TK_NE; adv = 2; } else { t.type = TK_NOT; }
          break;
        case '<':
          if (d == '=') { t.type = TK_LE; adv = 2; } else { t.type = TK_LT; }
          break;
        case '>':
          if (d == '=') { t.type = TK_GE; adv = 2; } else { t.type = TK_GT; }
          break;
        case '&':
          if (d == '&') { t.type = TK_AND; adv = 2; } else {
            fail_at(path, line, "unexpected character '&' (did you mean '&&'?)");
          }
          break;
        case '|':
          if (d == '|') { t.type = TK_OR; adv = 2; } else {
            fail_at(path, line, "unexpected character '|' (did you mean '||'?)");
          }
          break;
        default:
          fail_at(path, line, "unexpected character '%c'", c);
      }

      t.len = adv;
      i += (size_t)adv;
      tokens_push(out, t);
    }
  }

  {
    Token t;
    memset(&t, 0, sizeof t);
    t.type = TK_EOF;
    t.start = src + n;
    t.line = line;
    tokens_push(out, t);
  }
}

/* ------------------------------------------------------------------ */
/* symbol tables                                                       */
/* ------------------------------------------------------------------ */

typedef struct Var {
  char *name;
  char *cname;
  int is_mut;
  struct Var *next;
} Var;

typedef struct Scope {
  Var *vars;
  struct Scope *prev;
} Scope;

typedef struct {
  char *name;
  int arity;
} FnInfo;

typedef struct {
  const char *name;
  const char *symbol;
  int arity;
} Builtin;

static const Builtin builtins[] = {
    {"print", "vela_print", 1},
    {"println", "vela_println", 1},
    {"len", "vela_builtin_len", 1},
    {"push", "vela_builtin_push", 2},
    {"at", "vela_builtin_at", 2},
    {"set", "vela_builtin_set", 3},
    {"str", "vela_builtin_str", 1},
    {"num", "vela_builtin_num", 1},
    {"type", "vela_builtin_type", 1},
    {"abs", "vela_builtin_abs", 1},
    {"sqrt", "vela_builtin_sqrt", 1},
    {"floor", "vela_builtin_floor", 1},
    {"ceil", "vela_builtin_ceil", 1},
    {"assert", "vela_builtin_assert", 1},
    {"error", "vela_builtin_error", 1},
    {"range", "vela_builtin_range", 1},
};

static const Builtin *builtin_find(const char *name) {
  for (size_t i = 0; i < sizeof(builtins) / sizeof(builtins[0]); i++) {
    if (strcmp(builtins[i].name, name) == 0) return &builtins[i];
  }
  return NULL;
}

typedef struct Parser {
  Token *toks;
  size_t count;
  size_t pos;
  const char *path;

  Buf protos;
  Buf decls;
  Buf main_body;
  Buf *out;

  int indent;
  int line_start;
  Scope *scope;

  int fn_depth;
  int loop_depth;
  int tmp;

  FnInfo *fns;
  size_t nfns;
  size_t fncap;
} Parser;

static VELA_NORETURN void perr(Parser *p, Token *t, const char *fmt, ...) {
  va_list ap;
  va_start(ap, fmt);
  fprintf(stderr, "%s:%d: error: ", p->path, t->line);
  vfprintf(stderr, fmt, ap);
  fputc('\n', stderr);
  va_end(ap);
  exit(1);
}

static FnInfo *fn_find(Parser *p, const char *name) {
  for (size_t i = 0; i < p->nfns; i++) {
    if (strcmp(p->fns[i].name, name) == 0) return &p->fns[i];
  }
  return NULL;
}

static void fn_add(Parser *p, char *name, int arity) {
  if (p->nfns == p->fncap) {
    p->fncap = p->fncap ? p->fncap * 2 : 16;
    p->fns = (FnInfo *)xrealloc(p->fns, p->fncap * sizeof(FnInfo));
  }
  p->fns[p->nfns].name = name;
  p->fns[p->nfns].arity = arity;
  p->nfns++;
}

static void scope_push(Parser *p) {
  Scope *s = (Scope *)xcalloc(1, sizeof(Scope));
  s->prev = p->scope;
  p->scope = s;
}

static void scope_pop(Parser *p) {
  Scope *s = p->scope;
  if (s == NULL) return;
  Var *v = s->vars;
  while (v != NULL) {
    Var *next = v->next;
    free(v->name);
    free(v->cname);
    free(v);
    v = next;
  }
  p->scope = s->prev;
  free(s);
}

static Var *scope_find(Parser *p, const char *name) {
  for (Scope *s = p->scope; s != NULL; s = s->prev) {
    for (Var *v = s->vars; v != NULL; v = v->next) {
      if (strcmp(v->name, name) == 0) return v;
    }
  }
  return NULL;
}

static char *token_text(Token *t) {
  char *s = (char *)xrealloc(NULL, (size_t)t->len + 1);
  memcpy(s, t->start, (size_t)t->len);
  s[t->len] = '\0';
  return s;
}

static char *mangle(const char *name) {
  size_t n = strlen(name);
  char *s = (char *)xrealloc(NULL, n + 3);
  memcpy(s, "v_", 2);
  memcpy(s + 2, name, n + 1);
  return s;
}

/* Declare a name in the current scope, returning its variable. */
static Var *scope_add_decl(Parser *p, Token *name_tok, int is_mut) {
  char *name = token_text(name_tok);
  for (Var *v = p->scope->vars; v != NULL; v = v->next) {
    if (strcmp(v->name, name) == 0) {
      perr(p, name_tok, "'%s' is already declared in this scope", name);
    }
  }
  Var *v = (Var *)xcalloc(1, sizeof(Var));
  v->name = name;
  v->cname = mangle(name);
  v->is_mut = is_mut;
  v->next = p->scope->vars;
  p->scope->vars = v;
  return v;
}

static void scope_check_dup(Parser *p, Token *name_tok) {
  char *name = token_text(name_tok);
  for (Var *v = p->scope->vars; v != NULL; v = v->next) {
    if (strcmp(v->name, name) == 0) {
      perr(p, name_tok, "'%s' is already declared in this scope", name);
    }
  }
  free(name);
}

/* ------------------------------------------------------------------ */
/* parser plumbing                                                     */
/* ------------------------------------------------------------------ */

static Token *pk(Parser *p, size_t off) {
  size_t i = p->pos + off;
  if (i >= p->count) i = p->count - 1;
  return &p->toks[i];
}

static Token *curp(Parser *p) { return &p->toks[p->pos]; }

static void advance_tok(Parser *p) {
  if (p->pos + 1 < p->count) p->pos++;
}

static int check(Parser *p, TokType t) { return curp(p)->type == t; }

static int match(Parser *p, TokType t) {
  if (check(p, t)) {
    advance_tok(p);
    return 1;
  }
  return 0;
}

static Token *expect_tok(Parser *p, TokType t, const char *what) {
  if (!check(p, t)) perr(p, curp(p), "expected %s", what);
  Token *t2 = curp(p);
  advance_tok(p);
  return t2;
}

/* ------------------------------------------------------------------ */
/* code emission                                                       */
/* ------------------------------------------------------------------ */

static void pre(Parser *p) {
  if (p->line_start) {
    p->line_start = 0;
    for (int i = 0; i < p->indent; i++) {
      buf_puts(p->out, "  ");
    }
  }
}

static void emit(Parser *p, const char *s) {
  pre(p);
  buf_puts(p->out, s);
}

static void emitf(Parser *p, const char *fmt, ...) {
  pre(p);
  va_list ap;
  va_start(ap, fmt);
  va_list ap2;
  va_copy(ap2, ap);
  int n = vsnprintf(NULL, 0, fmt, ap);
  va_end(ap);
  if (n > 0) {
    buf_reserve(p->out, (size_t)n);
    vsnprintf(p->out->data + p->out->len, (size_t)n + 1, fmt, ap2);
    p->out->len += (size_t)n;
  }
  va_end(ap2);
}

static void nl(Parser *p) {
  buf_putc(p->out, '\n');
  p->line_start = 1;
}

static void emit_c_string(Parser *p, const char *s) {
  pre(p);
  buf_putc(p->out, '"');
  for (const char *q = s; *q != '\0'; q++) {
    unsigned char c = (unsigned char)*q;
    switch (c) {
      case '"': buf_puts(p->out, "\\\""); break;
      case '\\': buf_puts(p->out, "\\\\"); break;
      case '\n': buf_puts(p->out, "\\n"); break;
      case '\t': buf_puts(p->out, "\\t"); break;
      case '\r': buf_puts(p->out, "\\r"); break;
      default:
        if (c < 32 || c == 127) {
          buf_printf(p->out, "\\%03o", (unsigned)c);
        } else {
          buf_putc(p->out, (char)c);
        }
        break;
    }
  }
  buf_putc(p->out, '"');
}

/* Generate an expression into a side buffer so it can be wrapped. */
typedef struct {
  Buf *saved;
  Buf tmp;
  int saved_line_start;
} Capture;

static void cap_begin(Parser *p, Capture *c) {
  c->saved = p->out;
  c->saved_line_start = p->line_start;
  memset(&c->tmp, 0, sizeof c->tmp);
  p->out = &c->tmp;
  p->line_start = 0;
}

static void cap_end(Parser *p, Capture *c) {
  p->out = c->saved;
  p->line_start = c->saved_line_start;
}

/* ------------------------------------------------------------------ */
/* code generation                                                     */
/* ------------------------------------------------------------------ */

static void gen_expr(Parser *p);
static void gen_assign(Parser *p);
static void gen_or(Parser *p);
static void gen_and(Parser *p);
static void gen_equality(Parser *p);
static void gen_comparison(Parser *p);
static void gen_term(Parser *p);
static void gen_factor(Parser *p);
static void gen_unary(Parser *p);
static void gen_call(Parser *p);
static void gen_primary(Parser *p);
static void gen_stmt(Parser *p);
static void gen_block(Parser *p, int add_return);
static void gen_fn(Parser *p);

typedef void (*LevelFn)(Parser *);
typedef const char *(*OpFn)(TokType);

static void gen_binary_level(Parser *p, void (*next)(Parser *), const char *(*fn_for)(TokType)) {
  Capture c;
  cap_begin(p, &c);
  next(p);

  for (;;) {
    const char *fn = fn_for(curp(p)->type);
    if (fn == NULL) break;
    advance_tok(p);

    Capture r;
    cap_begin(p, &r);
    next(p);
    cap_end(p, &r);

    {
      Buf combined = {0};
      buf_puts(&combined, fn);
      buf_puts(&combined, "((");
      buf_puts(&combined, c.tmp.data ? c.tmp.data : "vela_nil()");
      buf_puts(&combined, "), (");
      buf_puts(&combined, r.tmp.data ? r.tmp.data : "vela_nil()");
      buf_puts(&combined, "))");
      free(c.tmp.data);
      free(r.tmp.data);
      c.tmp = combined;
    }
  }

  cap_end(p, &c);
  pre(p);
  buf_puts(p->out, c.tmp.data ? c.tmp.data : "vela_nil()");
  free(c.tmp.data);
}

static const char *eq_fn(TokType t) {
  if (t == TK_EQ) return "vela_eq";
  if (t == TK_NE) return "vela_ne";
  return NULL;
}

static const char *cmp_fn(TokType t) {
  switch (t) {
    case TK_LT: return "vela_lt";
    case TK_LE: return "vela_le";
    case TK_GT: return "vela_gt";
    case TK_GE: return "vela_ge";
    default: return NULL;
  }
}

static const char *term_fn(TokType t) {
  switch (t) {
    case TK_PLUS: return "vela_add";
    case TK_MINUS: return "vela_sub";
    default: return NULL;
  }
}

static const char *factor_fn(TokType t) {
  switch (t) {
    case TK_STAR: return "vela_mul";
    case TK_SLASH: return "vela_div";
    case TK_PERCENT: return "vela_mod";
    default: return NULL;
  }
}

static void gen_equality(Parser *p) { gen_binary_level(p, gen_comparison, eq_fn); }
static void gen_comparison(Parser *p) { gen_binary_level(p, gen_term, cmp_fn); }
static void gen_term(Parser *p) { gen_binary_level(p, gen_factor, term_fn); }
static void gen_factor(Parser *p) { gen_binary_level(p, gen_unary, factor_fn); }

static void gen_and(Parser *p) {
  Capture c;
  cap_begin(p, &c);
  gen_equality(p);

  while (check(p, TK_AND)) {
    advance_tok(p);

    Capture r;
    cap_begin(p, &r);
    gen_equality(p);
    cap_end(p, &r);

    {
      Buf combined = {0};
      buf_puts(&combined, "((vela_truthy(");
      buf_puts(&combined, c.tmp.data ? c.tmp.data : "vela_nil()");
      buf_puts(&combined, ")) ? vela_bool(vela_truthy(");
      buf_puts(&combined, r.tmp.data ? r.tmp.data : "vela_nil()");
      buf_puts(&combined, ")) : vela_bool(0))");
      free(c.tmp.data);
      free(r.tmp.data);
      c.tmp = combined;
    }
  }

  cap_end(p, &c);
  pre(p);
  buf_puts(p->out, c.tmp.data ? c.tmp.data : "vela_nil()");
  free(c.tmp.data);
}

static void gen_or(Parser *p) {
  Capture c;
  cap_begin(p, &c);
  gen_and(p);

  while (check(p, TK_OR)) {
    advance_tok(p);

    Capture r;
    cap_begin(p, &r);
    gen_and(p);
    cap_end(p, &r);

    {
      Buf combined = {0};
      buf_puts(&combined, "((vela_truthy(");
      buf_puts(&combined, c.tmp.data ? c.tmp.data : "vela_nil()");
      buf_puts(&combined, ")) ? vela_bool(1) : vela_bool(vela_truthy(");
      buf_puts(&combined, r.tmp.data ? r.tmp.data : "vela_nil()");
      buf_puts(&combined, ")))");
      free(c.tmp.data);
      free(r.tmp.data);
      c.tmp = combined;
    }
  }

  cap_end(p, &c);
  pre(p);
  buf_puts(p->out, c.tmp.data ? c.tmp.data : "vela_nil()");
  free(c.tmp.data);
}

static int is_assign_op(TokType t) {
  return t == TK_ASSIGN || t == TK_PLUS_EQ || t == TK_MINUS_EQ || t == TK_STAR_EQ ||
         t == TK_SLASH_EQ;
}

static void gen_assign(Parser *p) {
  if (check(p, TK_IDENT) && is_assign_op(pk(p, 1)->type)) {
    Token *name_tok = curp(p);
    char *name = token_text(name_tok);
    Var *v = scope_find(p, name);
    if (v == NULL) perr(p, name_tok, "undefined variable '%s'", name);
    free(name);

    TokType op = pk(p, 1)->type;
    advance_tok(p); /* name */
    advance_tok(p); /* operator */

    if (!v->is_mut) {
      perr(p, name_tok, "cannot assign to '%s': declare it with 'mut' instead of 'let'",
           v->name);
    }

    if (op == TK_ASSIGN) {
      emitf(p, "%s = ", v->cname);
      gen_assign(p);
    } else {
      const char *fn = "vela_add";
      if (op == TK_MINUS_EQ) fn = "vela_sub";
      else if (op == TK_STAR_EQ) fn = "vela_mul";
      else if (op == TK_SLASH_EQ) fn = "vela_div";
      emitf(p, "%s = %s(%s, ", v->cname, fn, v->cname);
      gen_assign(p);
      emit(p, ")");
    }
    return;
  }

  gen_or(p);
  if (is_assign_op(curp(p)->type)) {
    perr(p, curp(p), "cannot assign to this expression");
  }
}

static void gen_expr(Parser *p) { gen_assign(p); }

static void gen_unary(Parser *p) {
  if (check(p, TK_NOT)) {
    advance_tok(p);
    emit(p, "vela_not((");
    gen_unary(p);
    emit(p, "))");
    return;
  }
  if (check(p, TK_MINUS)) {
    advance_tok(p);
    emit(p, "vela_neg((");
    gen_unary(p);
    emit(p, "))");
    return;
  }
  gen_call(p);
}

static void gen_primary(Parser *p) {
  Token *t = curp(p);
  switch (t->type) {
    case TK_NUMBER:
      emitf(p, "vela_num(%.17g)", t->num);
      advance_tok(p);
      break;
    case TK_STRING:
      emit(p, "vela_str(");
      emit_c_string(p, t->str);
      emit(p, ")");
      advance_tok(p);
      break;
    case TK_TRUE:
      emit(p, "vela_bool(1)");
      advance_tok(p);
      break;
    case TK_FALSE:
      emit(p, "vela_bool(0)");
      advance_tok(p);
      break;
    case TK_NIL:
      emit(p, "vela_nil()");
      advance_tok(p);
      break;
    case TK_LPAREN:
      advance_tok(p);
      emit(p, "(");
      gen_expr(p);
      emit(p, ")");
      expect_tok(p, TK_RPAREN, "')'");
      break;
    case TK_LBRACKET: {
      Buf items = {0};
      int count = 0;
      advance_tok(p);
      if (!check(p, TK_RBRACKET)) {
        for (;;) {
          Capture c;
          cap_begin(p, &c);
          gen_expr(p);
          cap_end(p, &c);
          if (count > 0) buf_puts(&items, ", ");
          buf_puts(&items, c.tmp.data ? c.tmp.data : "vela_nil()");
          free(c.tmp.data);
          count++;
          if (!match(p, TK_COMMA)) break;
        }
      }
      expect_tok(p, TK_RBRACKET, "']'");
      if (count == 0) {
        emit(p, "vela_list_from(0, NULL)");
      } else {
        emitf(p, "vela_list_from(%d, (vela_value[]){", count);
        pre(p);
        buf_puts(p->out, items.data ? items.data : "");
        emit(p, "})");
      }
      free(items.data);
      break;
    }
    case TK_IDENT: {
      char *name = token_text(t);
      Var *v = scope_find(p, name);
      if (v == NULL) perr(p, t, "undefined variable '%s'", name);
      emit(p, v->cname);
      advance_tok(p);
      free(name);
      break;
    }
    default:
      perr(p, t, "expected an expression");
  }
}

static void gen_call(Parser *p) {
  if (check(p, TK_IDENT) && pk(p, 1)->type == TK_LPAREN) {
    Token *name_tok = curp(p);
    char *name = token_text(name_tok);

    if (scope_find(p, name) != NULL) {
      perr(p, name_tok, "'%s' is a variable, and calling values is not supported yet", name);
    }

    const Builtin *b = builtin_find(name);
    FnInfo *fn = NULL;
    if (b == NULL) {
      fn = fn_find(p, name);
      if (fn == NULL) perr(p, name_tok, "unknown function '%s'", name);
    }

    advance_tok(p); /* name */
    advance_tok(p); /* '(' */

    if (b != NULL) {
      emitf(p, "%s(", b->symbol);
    } else {
      emitf(p, "f_%s(", name);
    }

    int nargs = 0;
    if (!check(p, TK_RPAREN)) {
      for (;;) {
        gen_expr(p);
        nargs++;
        if (!match(p, TK_COMMA)) break;
        emit(p, ", ");
      }
    }
    expect_tok(p, TK_RPAREN, "')'");

    {
      int arity = (b != NULL) ? b->arity : fn->arity;
      if (nargs != arity) {
        perr(p, name_tok, "%s() takes %d argument(s), %d given", name, arity, nargs);
      }
    }

    emit(p, ")");
    free(name);
    return;
  }

  gen_primary(p);
}


/* ------------------------------------------------------------------ */
/* statements                                                          */
/* ------------------------------------------------------------------ */

static void close_block(Parser *p) {
  if (!p->line_start) nl(p);
  p->indent--;
  emit(p, "}");
}

static void gen_block(Parser *p, int add_return) {
  expect_tok(p, TK_LBRACE, "'{'");
  scope_push(p);
  emit(p, " {");
  p->indent++;
  nl(p);
  while (!check(p, TK_RBRACE) && !check(p, TK_EOF)) {
    gen_stmt(p);
    nl(p);
  }
  expect_tok(p, TK_RBRACE, "'}'");
  if (add_return) {
    emit(p, "return vela_nil();");
    nl(p);
  }
  close_block(p);
  scope_pop(p);
}

static void gen_let(Parser *p) {
  int is_mut = check(p, TK_MUT);
  Token *name_tok;
  char *name;
  char *cname;

  advance_tok(p); /* 'let' or 'mut' */
  name_tok = expect_tok(p, TK_IDENT, "a variable name");
  scope_check_dup(p, name_tok);

  name = token_text(name_tok);
  cname = mangle(name);
  free(name);

  if (match(p, TK_ASSIGN)) {
    emitf(p, "vela_value %s = ", cname);
    gen_expr(p);
    emit(p, ";");
  } else {
    emitf(p, "vela_value %s = vela_nil();", cname);
  }

  free(cname);
  scope_add_decl(p, name_tok, is_mut);
}

static void gen_if(Parser *p) {
  expect_tok(p, TK_IF, "'if'");
  emit(p, "if (vela_truthy(");
  gen_expr(p);
  emit(p, "))");
  gen_block(p, 0);
  if (match(p, TK_ELSE)) {
    emit(p, " else ");
    if (check(p, TK_IF)) {
      gen_if(p);
    } else {
      gen_block(p, 0);
    }
  }
}

static void gen_while(Parser *p) {
  expect_tok(p, TK_WHILE, "'while'");
  emit(p, "while (vela_truthy(");
  gen_expr(p);
  emit(p, "))");
  p->loop_depth++;
  gen_block(p, 0);
  p->loop_depth--;
}

static void gen_for(Parser *p) {
  int id = p->tmp++;
  Token *name_tok;
  char *name;
  char *cname;

  expect_tok(p, TK_FOR, "'for'");
  name_tok = expect_tok(p, TK_IDENT, "a loop variable name");
  expect_tok(p, TK_IN, "'in'");

  emit(p, "{");
  p->indent++;
  nl(p);
  emitf(p, "vela_value vela_it_%d = ", id);
  gen_expr(p);
  expect_tok(p, TK_LBRACE, "'{'");
  emit(p, ";");
  nl(p);
  emitf(p, "vela_list *vela_lst_%d = vela_as_list(vela_it_%d, \"for loop\");", id, id);
  nl(p);
  emitf(p, "for (size_t vela_i_%d = 0; vela_i_%d < vela_lst_%d->len; vela_i_%d += 1) {",
        id, id, id, id);
  p->indent++;
  nl(p);

  scope_push(p);
  name = token_text(name_tok);
  cname = mangle(name);
  emitf(p, "vela_value %s = vela_lst_%d->items[vela_i_%d];", cname, id, id);
  free(cname);
  free(name);
  scope_add_decl(p, name_tok, 1);
  nl(p);

  p->loop_depth++;
  while (!check(p, TK_RBRACE) && !check(p, TK_EOF)) {
    gen_stmt(p);
    nl(p);
  }
  expect_tok(p, TK_RBRACE, "'}'");
  p->loop_depth--;
  close_block(p);
  scope_pop(p);
  close_block(p);
}

static void gen_return(Parser *p) {
  expect_tok(p, TK_RETURN, "'return'");
  if (p->fn_depth == 0) {
    perr(p, pk(p, 0), "'return' can only be used inside a function");
  }
  emit(p, "return ");
  gen_expr(p);
  emit(p, ";");
}

static void gen_stmt(Parser *p) {
  switch (curp(p)->type) {
    case TK_LET:
    case TK_MUT:
      gen_let(p);
      break;
    case TK_FN:
      gen_fn(p);
      break;
    case TK_IF:
      gen_if(p);
      break;
    case TK_WHILE:
      gen_while(p);
      break;
    case TK_FOR:
      gen_for(p);
      break;
    case TK_RETURN:
      gen_return(p);
      break;
    case TK_BREAK:
      if (p->loop_depth == 0) perr(p, curp(p), "'break' outside of a loop");
      advance_tok(p);
      emit(p, "break;");
      break;
    case TK_CONTINUE:
      if (p->loop_depth == 0) perr(p, curp(p), "'continue' outside of a loop");
      advance_tok(p);
      emit(p, "continue;");
      break;
    case TK_LBRACE:
      gen_block(p, 0);
      break;
    default:
      gen_expr(p);
      emit(p, ";");
      break;
  }
}

static void gen_fn(Parser *p) {
  Token *name_tok;
  char *name;
  Buf sig = {0};
  int arity = 0;
  Buf *saved_out;
  int saved_indent;

  expect_tok(p, TK_FN, "'fn'");
  name_tok = expect_tok(p, TK_IDENT, "a function name");
  name = token_text(name_tok);

  if (fn_find(p, name) == NULL) {
    perr(p, name_tok, "functions must be declared at the top level");
  }

  scope_push(p);
  expect_tok(p, TK_LPAREN, "'('");
  if (!check(p, TK_RPAREN)) {
    for (;;) {
      Token *pt = expect_tok(p, TK_IDENT, "a parameter name");
      Var *v = scope_add_decl(p, pt, 1);
      if (arity > 0) buf_puts(&sig, ", ");
      buf_printf(&sig, "vela_value %s", v->cname);
      arity++;
      if (!match(p, TK_COMMA)) break;
    }
  }
  expect_tok(p, TK_RPAREN, "')'");

  saved_out = p->out;
  saved_indent = p->indent;
  p->out = &p->decls;
  p->indent = 0;

  emit(p, "static vela_value f_");
  emit(p, name);
  emit(p, "(");
  if (arity == 0) {
    emit(p, "void");
  } else {
    pre(p);
    buf_puts(p->out, sig.data ? sig.data : "void");
  }
  emit(p, ")");

  p->fn_depth++;
  gen_block(p, 1);
  p->fn_depth--;
  nl(p);

  p->out = saved_out;
  p->indent = saved_indent;

  scope_pop(p);
  free(name);
  free(sig.data);
}

/* ------------------------------------------------------------------ */
/* function prototypes (so functions may call each other freely)        */
/* ------------------------------------------------------------------ */

static void emit_prototypes(Parser *p) {
  int depth = 0;
  for (size_t i = 0; i < p->count; i++) {
    Token *t = &p->toks[i];
    if (t->type == TK_LBRACE) {
      depth++;
      continue;
    }
    if (t->type == TK_RBRACE) {
      depth--;
      continue;
    }
    if (depth != 0 || t->type != TK_FN) continue;

    if (i + 1 >= p->count || p->toks[i + 1].type != TK_IDENT) {
      fail_at(p->path, t->line, "expected a function name after 'fn'");
    }
    {
      char *name = token_text(&p->toks[i + 1]);
      size_t j = i + 2;
      int arity = 0;

      if (j >= p->count || p->toks[j].type != TK_LPAREN) {
        fail_at(p->path, t->line, "expected '(' after the function name");
      }
      j++;
      if (j < p->count && p->toks[j].type != TK_RPAREN) {
        arity = 1;
        for (; j < p->count; j++) {
          if (p->toks[j].type == TK_COMMA) arity++;
          if (p->toks[j].type == TK_RPAREN) break;
        }
      }

      if (fn_find(p, name) != NULL) {
        fail_at(p->path, t->line, "function '%s' is defined more than once", name);
      }
      fn_add(p, name, arity);

      buf_printf(&p->protos, "static vela_value f_%s(", name);
      if (arity == 0) {
        buf_puts(&p->protos, "void");
      } else {
        for (int k = 0; k < arity; k++) {
          buf_printf(&p->protos, "%svela_value", k ? ", " : "");
        }
      }
      buf_puts(&p->protos, ");\n");
    }
  }
}

/* ------------------------------------------------------------------ */
/* driver                                                              */
/* ------------------------------------------------------------------ */

static Buf parse_program(const char *src, const char *path) {
  TokenList tl = {0};
  Parser p;
  Buf file = {0};

  lex(src, path, &tl);

  memset(&p, 0, sizeof p);
  p.toks = tl.items;
  p.count = tl.count;
  p.path = path;
  p.indent = 1;
  p.line_start = 1;

  scope_push(&p);
  emit_prototypes(&p);

  p.out = &p.main_body;
  while (!check(&p, TK_EOF)) {
    gen_stmt(&p);
    nl(&p);
  }
  scope_pop(&p);

  buf_printf(&file, "/* Generated by velac %s from %s. Do not edit. */\n\n", VELA_VERSION,
             path);
  buf_puts(&file, "#include \"vela_runtime.h\"\n\n");
  if (p.protos.len) {
    buf_puts(&file, p.protos.data);
    buf_puts(&file, "\n");
  }
  if (p.decls.len) {
    buf_puts(&file, p.decls.data);
    buf_puts(&file, "\n");
  }
  buf_puts(&file, "vela_value vela_main(void) {\n");
  if (p.main_body.len) {
    buf_puts(&file, p.main_body.data);
  }
  buf_puts(&file, "  return vela_nil();\n}\n");
  return file;
}

/* ------------------------------------------------------------------ */
/* files and processes                                                 */
/* ------------------------------------------------------------------ */

static char *read_file(const char *path) {
  FILE *f = fopen(path, "rb");
  char *data;
  size_t got;
  long size;

  if (f == NULL) fail_cli("cannot open '%s': %s", path, strerror(errno));
  if (fseek(f, 0, SEEK_END) != 0) fail_cli("cannot read '%s'", path);
  size = ftell(f);
  if (size < 0) fail_cli("cannot read '%s'", path);
  if (fseek(f, 0, SEEK_SET) != 0) fail_cli("cannot read '%s'", path);

  data = (char *)xrealloc(NULL, (size_t)size + 1);
  got = fread(data, 1, (size_t)size, f);
  data[got] = '\0';
  fclose(f);
  return data;
}

static void write_file(const char *path, const char *data, size_t len) {
  FILE *f = fopen(path, "wb");
  if (f == NULL) fail_cli("cannot write '%s': %s", path, strerror(errno));
  if (len > 0 && fwrite(data, 1, len, f) != len) {
    fclose(f);
    fail_cli("cannot write '%s'", path);
  }
  if (fclose(f) != 0) fail_cli("cannot write '%s'", path);
}

static void shq(Buf *b, const char *s) {
  buf_putc(b, '\'');
  for (const char *q = s; *q != '\0'; q++) {
    if (*q == '\'') {
      buf_puts(b, "'\\''");
    } else {
      buf_putc(b, *q);
    }
  }
  buf_putc(b, '\'');
}

static int file_exists(const char *path) {
  FILE *f = fopen(path, "rb");
  if (f != NULL) {
    fclose(f);
    return 1;
  }
  return 0;
}

static void exe_dir(char *out, size_t cap) {
  out[0] = '\0';
#ifdef __APPLE__
  {
    char tmp[4096];
    uint32_t size = (uint32_t)sizeof tmp;
    if (_NSGetExecutablePath(tmp, &size) == 0) {
      char *slash = strrchr(tmp, '/');
      if (slash != NULL) *slash = '\0';
      snprintf(out, cap, "%s", tmp);
      return;
    }
  }
#endif
#if defined(__linux__)
  {
    char tmp[4096];
    ssize_t n = readlink("/proc/self/exe", tmp, sizeof tmp - 1);
    if (n > 0) {
      char *slash;
      tmp[n] = '\0';
      slash = strrchr(tmp, '/');
      if (slash != NULL) *slash = '\0';
      snprintf(out, cap, "%s", tmp);
      return;
    }
  }
#endif
}

static int has_runtime(const char *dir) {
  char p[2048];
  snprintf(p, sizeof p, "%s/vela_runtime.c", dir);
  return file_exists(p);
}

static int resolve_runtime(const char *given, const char *argv0, char *out, size_t cap) {
  char dir[1024];

  if (given != NULL && *given) {
    if (has_runtime(given)) {
      snprintf(out, cap, "%s", given);
      return 1;
    }
    return 0;
  }

  exe_dir(dir, sizeof dir);
  if (dir[0]) {
    snprintf(out, cap, "%s/runtime", dir);
    if (has_runtime(out)) return 1;
    snprintf(out, cap, "%s/../lib/vela/runtime", dir);
    if (has_runtime(out)) return 1;
    snprintf(out, cap, "%s/../share/vela/runtime", dir);
    if (has_runtime(out)) return 1;
  }

  if (argv0 != NULL && strchr(argv0, '/') != NULL) {
    const char *slash = strrchr(argv0, '/');
    size_t n = (size_t)(slash - argv0);
    if (n > 0 && n < sizeof dir) {
      memcpy(dir, argv0, n);
      dir[n] = '\0';
      snprintf(out, cap, "%s/runtime", dir);
      if (has_runtime(out)) return 1;
    }
  }

  return 0;
}

static char *stem_of(const char *path) {
  const char *base = strrchr(path, '/');
  size_t n;
  char *stem;

  base = (base != NULL) ? base + 1 : path;
  n = strcspn(base, ".");
  if (n == 0) n = strlen(base);
  stem = (char *)xrealloc(NULL, n + 1);
  memcpy(stem, base, n);
  stem[n] = '\0';
  return stem;
}

static void usage(void) {
  printf("velac %s - the Vela compiler\n\n", VELA_VERSION);
  printf("usage: velac <file.vela> [options]\n\n");
  printf("  -o <path>        write the program (or the C file with --emit-c) to <path>\n");
  printf("  --emit-c         write the generated C, do not compile it\n");
  printf("  --cc <name>      C compiler to use (default: $CC, else cc)\n");
  printf("  --runtime <dir>  directory holding vela_runtime.c\n");
  printf("                   (default: $VELA_RUNTIME, else the runtime shipped with velac)\n");
  printf("  -v, --version    print the version\n");
  printf("  -h, --help       print this help\n");
  printf("\nVela is compiled to C first and then built with the host C compiler, so\n");
  printf("macOS, iOS and Debian need nothing but their own toolchain.\n");
}

int main(int argc, char **argv) {
  const char *input = NULL;
  const char *output = NULL;
  const char *cc = getenv("CC");
  const char *runtime_arg = getenv("VELA_RUNTIME");
  int emit_c = 0;
  char *src;
  Buf program;
  char cpath[2048];
  char out_buffer[2048];
  const char *out_path = NULL;
  char *stem;

  if (cc == NULL || *cc == '\0') cc = "cc";

  for (int i = 1; i < argc; i++) {
    const char *a = argv[i];
    if (strcmp(a, "--version") == 0 || strcmp(a, "-v") == 0) {
      printf("velac %s (Vela %s)\n", VELA_VERSION, VELA_VERSION);
      return 0;
    } else if (strcmp(a, "--help") == 0 || strcmp(a, "-h") == 0) {
      usage();
      return 0;
    } else if (strcmp(a, "--emit-c") == 0) {
      emit_c = 1;
    } else if (strcmp(a, "-o") == 0) {
      if (i + 1 >= argc) fail_cli("-o needs a path");
      output = argv[++i];
    } else if (strcmp(a, "--cc") == 0) {
      if (i + 1 >= argc) fail_cli("--cc needs a program name");
      cc = argv[++i];
    } else if (strncmp(a, "--cc=", 5) == 0) {
      cc = a + 5;
    } else if (strcmp(a, "--runtime") == 0) {
      if (i + 1 >= argc) fail_cli("--runtime needs a directory");
      runtime_arg = argv[++i];
    } else if (strncmp(a, "--runtime=", 10) == 0) {
      runtime_arg = a + 10;
    } else if (a[0] == '-' && a[1] != '\0') {
      fail_cli("unknown option '%s' (try --help)", a);
    } else if (input == NULL) {
      input = a;
    } else {
      fail_cli("more than one input file given");
    }
  }

  if (input == NULL) {
    usage();
    return 1;
  }

  stem = stem_of(input);
  if (emit_c) {
    if (output != NULL) {
      snprintf(cpath, sizeof cpath, "%s", output);
    } else {
      snprintf(cpath, sizeof cpath, "%s.c", stem);
    }
  } else {
    if (output != NULL) {
      snprintf(out_buffer, sizeof out_buffer, "%s", output);
    } else {
      snprintf(out_buffer, sizeof out_buffer, "%s", stem);
    }
    out_path = out_buffer;
    snprintf(cpath, sizeof cpath, "%s.c", out_path);
  }

  src = read_file(input);
  program = parse_program(src, input);
  write_file(cpath, program.data ? program.data : "", program.len);

  if (emit_c) {
    free(stem);
    free(src);
    free(program.data);
    return 0;
  }

  {
    char runtime[2048];
    Buf cmd = {0};
    char rtp[2304];
    int rc;

    if (!resolve_runtime(runtime_arg, argv[0], runtime, sizeof runtime)) {
      fail_cli("cannot find the Vela runtime (vela_runtime.c).\n"
               "  pass --runtime <dir>, set VELA_RUNTIME, or install the runtime\n"
               "  in <prefix>/lib/vela/runtime next to velac.");
    }

    buf_puts(&cmd, cc);
    buf_puts(&cmd, " -std=c11 -O2 -o ");
    shq(&cmd, out_path);
    buf_putc(&cmd, ' ');
    shq(&cmd, cpath);

    snprintf(rtp, sizeof rtp, "%s/vela_runtime.c", runtime);
    buf_putc(&cmd, ' ');
    shq(&cmd, rtp);

    snprintf(rtp, sizeof rtp, "%s/vela_main.c", runtime);
    buf_putc(&cmd, ' ');
    shq(&cmd, rtp);

    buf_puts(&cmd, " -I ");
    shq(&cmd, runtime);
    buf_puts(&cmd, " -lm");

    rc = system(cmd.data);
    free(cmd.data);
    if (rc != 0) {
      fail_cli("the C compiler failed; the generated C is in '%s'", cpath);
    }
  }

  free(stem);
  free(src);
  free(program.data);
  return 0;
}
