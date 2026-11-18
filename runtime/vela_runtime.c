/*
 * The Vela runtime: the dynamic semantics behind every vela_value.
 *
 * Values are immutable, and memory is never freed: a Vela 0.1.0 program
 * allocates and keeps everything it makes (see the roadmap in the README).
 */

#include "vela_runtime.h"

#include <math.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

vela_write_fn vela_write_hook = NULL;

void vela_write(const char *text) {
  if (vela_write_hook != NULL) {
    vela_write_hook(text);
    return;
  }
  fputs(text, stdout);
}

VELA_NORETURN void vela_panic(const char *fmt, ...) {
  va_list ap;
  va_start(ap, fmt);
  fflush(stdout);
  fputs("vela: runtime error: ", stderr);
  vfprintf(stderr, fmt, ap);
  fputc('\n', stderr);
  va_end(ap);
  exit(1);
}

static void *vela_alloc(size_t n) {
  void *p = calloc(1, n ? n : 1);
  if (p == NULL) vela_panic("out of memory");
  return p;
}

static void *vela_realloc(void *p, size_t n) {
  void *q = realloc(p, n ? n : 1);
  if (q == NULL) vela_panic("out of memory");
  return q;
}

/* ------------------------------------------------------------------ */
/* small string builder                                                */
/* ------------------------------------------------------------------ */

typedef struct {
  char *data;
  size_t len;
  size_t cap;
} StrBuf;

static void sb_reserve(StrBuf *b, size_t extra) {
  if (b->len + extra + 1 <= b->cap) return;
  {
    size_t cap = b->cap ? b->cap : 64;
    while (cap < b->len + extra + 1) cap *= 2;
    b->data = (char *)vela_realloc(b->data, cap);
    b->cap = cap;
    b->data[b->len] = '\0';
  }
}

static void sb_putc(StrBuf *b, char c) {
  sb_reserve(b, 1);
  b->data[b->len++] = c;
  b->data[b->len] = '\0';
}

static void sb_puts(StrBuf *b, const char *s) {
  size_t n = strlen(s);
  sb_reserve(b, n);
  memcpy(b->data + b->len, s, n);
  b->len += n;
  b->data[b->len] = '\0';
}

/* ------------------------------------------------------------------ */
/* values                                                              */
/* ------------------------------------------------------------------ */

vela_value vela_nil(void) {
  vela_value v;
  v.type = VELA_NIL;
  v.as.num = 0;
  return v;
}

vela_value vela_num(double n) {
  vela_value v;
  v.type = VELA_NUM;
  v.as.num = n;
  return v;
}

vela_value vela_bool(int b) {
  vela_value v;
  v.type = VELA_BOOL;
  v.as.boolean = b ? 1 : 0;
  return v;
}

vela_value vela_str(const char *s) {
  vela_value v;
  v.type = VELA_STR;
  v.as.str = s ? s : "";
  return v;
}

static const char *type_name(vela_value v) {
  switch (v.type) {
    case VELA_NIL: return "nil";
    case VELA_NUM: return "num";
    case VELA_BOOL: return "bool";
    case VELA_STR: return "str";
    case VELA_LIST: return "list";
  }
  return "?";
}

vela_value vela_list_from(size_t count, vela_value *items) {
  vela_list *l = (vela_list *)vela_alloc(sizeof(vela_list));
  vela_value v;
  l->len = count;
  l->cap = count;
  if (count > 0) {
    l->items = (vela_value *)vela_alloc(count * sizeof(vela_value));
    memcpy(l->items, items, count * sizeof(vela_value));
  }
  v.type = VELA_LIST;
  v.as.list = l;
  return v;
}

vela_list *vela_as_list(vela_value v, const char *what) {
  if (v.type != VELA_LIST) {
    vela_panic("%s expects a list, got %s", what, type_name(v));
  }
  return v.as.list;
}

int vela_truthy(vela_value v) {
  switch (v.type) {
    case VELA_NIL: return 0;
    case VELA_BOOL: return v.as.boolean != 0;
    case VELA_NUM: return v.as.num != 0;
    case VELA_STR: return v.as.str[0] != '\0';
    case VELA_LIST: return v.as.list->len > 0;
  }
  return 0;
}

static void format_num(double d, char *out, size_t cap) {
  if (d >= -1e15 && d <= 1e15 && d == (double)(long long)d) {
    snprintf(out, cap, "%lld", (long long)d);
  } else {
    snprintf(out, cap, "%g", d);
  }
}

static void value_to_sb(StrBuf *b, vela_value v) {
  char tmp[64];
  switch (v.type) {
    case VELA_NIL:
      sb_puts(b, "nil");
      break;
    case VELA_BOOL:
      sb_puts(b, v.as.boolean ? "true" : "false");
      break;
    case VELA_NUM:
      format_num(v.as.num, tmp, sizeof tmp);
      sb_puts(b, tmp);
      break;
    case VELA_STR:
      sb_puts(b, v.as.str);
      break;
    case VELA_LIST:
      sb_putc(b, '[');
      for (size_t i = 0; i < v.as.list->len; i++) {
        if (i > 0) sb_puts(b, ", ");
        value_to_sb(b, v.as.list->items[i]);
      }
      sb_putc(b, ']');
      break;
  }
}

const char *vela_to_cstr(vela_value v) {
  StrBuf b = {0};
  value_to_sb(&b, v);
  if (b.data == NULL) return "";
  return b.data;
}

static double need_num(vela_value v, const char *what) {
  if (v.type != VELA_NUM) {
    vela_panic("%s expects a number, got %s", what, type_name(v));
  }
  return v.as.num;
}

static const char *need_str(vela_value v, const char *what) {
  if (v.type != VELA_STR) {
    vela_panic("%s expects a string, got %s", what, type_name(v));
  }
  return v.as.str;
}

/* ------------------------------------------------------------------ */
/* operators                                                           */
/* ------------------------------------------------------------------ */

vela_value vela_add(vela_value a, vela_value b) {
  if (a.type == VELA_NUM && b.type == VELA_NUM) {
    return vela_num(a.as.num + b.as.num);
  }
  if (a.type == VELA_LIST && b.type == VELA_LIST) {
    size_t n1 = a.as.list->len;
    size_t n2 = b.as.list->len;
    vela_list *l = (vela_list *)vela_alloc(sizeof(vela_list));
    vela_value v;
    l->len = n1 + n2;
    l->cap = l->len;
    if (l->len > 0) {
      l->items = (vela_value *)vela_alloc(l->len * sizeof(vela_value));
      if (n1 > 0) memcpy(l->items, a.as.list->items, n1 * sizeof(vela_value));
      if (n2 > 0) memcpy(l->items + n1, b.as.list->items, n2 * sizeof(vela_value));
    }
    v.type = VELA_LIST;
    v.as.list = l;
    return v;
  }
  if (a.type == VELA_STR || b.type == VELA_STR) {
    const char *x = vela_to_cstr(a);
    const char *y = vela_to_cstr(b);
    size_t n1 = strlen(x);
    size_t n2 = strlen(y);
    char *out = (char *)vela_alloc(n1 + n2 + 1);
    memcpy(out, x, n1);
    memcpy(out + n1, y, n2 + 1);
    return vela_str(out);
  }
  vela_panic("cannot add %s and %s", type_name(a), type_name(b));
}

vela_value vela_sub(vela_value a, vela_value b) {
  return vela_num(need_num(a, "-") - need_num(b, "-"));
}

vela_value vela_mul(vela_value a, vela_value b) {
  return vela_num(need_num(a, "*") * need_num(b, "*"));
}

vela_value vela_div(vela_value a, vela_value b) {
  double x = need_num(a, "/");
  double y = need_num(b, "/");
  if (y == 0) vela_panic("division by zero");
  return vela_num(x / y);
}

vela_value vela_mod(vela_value a, vela_value b) {
  double x = need_num(a, "%");
  double y = need_num(b, "%");
  if (y == 0) vela_panic("division by zero in %");
  return vela_num(fmod(x, y));
}

vela_value vela_neg(vela_value a) { return vela_num(-need_num(a, "unary -")); }

vela_value vela_not(vela_value a) { return vela_bool(!vela_truthy(a)); }

static int values_equal(vela_value a, vela_value b) {
  if (a.type != b.type) return 0;
  switch (a.type) {
    case VELA_NIL: return 1;
    case VELA_BOOL: return (a.as.boolean != 0) == (b.as.boolean != 0);
    case VELA_NUM: return a.as.num == b.as.num;
    case VELA_STR: return strcmp(a.as.str, b.as.str) == 0;
    case VELA_LIST: {
      if (a.as.list->len != b.as.list->len) return 0;
      for (size_t i = 0; i < a.as.list->len; i++) {
        if (!values_equal(a.as.list->items[i], b.as.list->items[i])) return 0;
      }
      return 1;
    }
  }
  return 0;
}

vela_value vela_eq(vela_value a, vela_value b) { return vela_bool(values_equal(a, b)); }
vela_value vela_ne(vela_value a, vela_value b) { return vela_bool(!values_equal(a, b)); }

static int compare(vela_value a, vela_value b, const char *what) {
  if (a.type == VELA_NUM && b.type == VELA_NUM) {
    if (a.as.num < b.as.num) return -1;
    if (a.as.num > b.as.num) return 1;
    return 0;
  }
  if (a.type == VELA_STR && b.type == VELA_STR) {
    return strcmp(a.as.str, b.as.str) < 0 ? -1 : (strcmp(a.as.str, b.as.str) > 0 ? 1 : 0);
  }
  vela_panic("%s expects two numbers or two strings, got %s and %s", what, type_name(a),
             type_name(b));
}

vela_value vela_lt(vela_value a, vela_value b) { return vela_bool(compare(a, b, "<") < 0); }
vela_value vela_le(vela_value a, vela_value b) { return vela_bool(compare(a, b, "<=") <= 0); }
vela_value vela_gt(vela_value a, vela_value b) { return vela_bool(compare(a, b, ">") > 0); }
vela_value vela_ge(vela_value a, vela_value b) { return vela_bool(compare(a, b, ">=") >= 0); }

/* ------------------------------------------------------------------ */
/* output and builtins                                                 */
/* ------------------------------------------------------------------ */

vela_value vela_print(vela_value v) {
  vela_write(vela_to_cstr(v));
  return vela_nil();
}

vela_value vela_println(vela_value v) {
  vela_write(vela_to_cstr(v));
  vela_write("\n");
  return vela_nil();
}

vela_value vela_builtin_len(vela_value v) {
  if (v.type == VELA_STR) return vela_num((double)strlen(v.as.str));
  if (v.type == VELA_LIST) return vela_num((double)v.as.list->len);
  vela_panic("len() expects a string or a list, got %s", type_name(v));
}

vela_value vela_builtin_push(vela_value list, vela_value item) {
  vela_list *l = vela_as_list(list, "push()");
  if (l->len == l->cap) {
    size_t cap = l->cap ? l->cap * 2 : 8;
    l->items = (vela_value *)vela_realloc(l->items, cap * sizeof(vela_value));
    l->cap = cap;
  }
  l->items[l->len++] = item;
  return list;
}

static size_t resolve_index(vela_list *l, vela_value index, const char *what) {
  double d = need_num(index, what);
  long long i;

  if (!(d >= -1e15 && d <= 1e15)) vela_panic("%s expects a whole-number index", what);
  i = (long long)d;
  if (d != (double)i) vela_panic("%s expects a whole-number index", what);
  if (i < 0) i += (long long)l->len;
  if (i < 0 || i >= (long long)l->len) {
    vela_panic("%s: index %lld is out of range for a list of %zu item(s)", what, i, l->len);
  }
  return (size_t)i;
}

vela_value vela_builtin_at(vela_value list, vela_value index) {
  vela_list *l = vela_as_list(list, "at()");
  return l->items[resolve_index(l, index, "at()")];
}

vela_value vela_builtin_set(vela_value list, vela_value index, vela_value value) {
  vela_list *l = vela_as_list(list, "set()");
  l->items[resolve_index(l, index, "set()")] = value;
  return list;
}

vela_value vela_builtin_str(vela_value v) { return vela_str(vela_to_cstr(v)); }

vela_value vela_builtin_num(vela_value v) {
  switch (v.type) {
    case VELA_NUM:
      return v;
    case VELA_BOOL:
      return vela_num(v.as.boolean ? 1 : 0);
    case VELA_NIL:
      return vela_num(0);
    case VELA_STR: {
      char *end = NULL;
      double d = strtod(v.as.str, &end);
      if (end == v.as.str) vela_panic("cannot convert '%s' to a number", v.as.str);
      return vela_num(d);
    }
    case VELA_LIST:
      break;
  }
  vela_panic("cannot convert %s to a number", type_name(v));
}

vela_value vela_builtin_type(vela_value v) { return vela_str(type_name(v)); }

vela_value vela_builtin_abs(vela_value v) { return vela_num(fabs(need_num(v, "abs()"))); }

vela_value vela_builtin_sqrt(vela_value v) {
  double d = need_num(v, "sqrt()");
  if (d < 0) vela_panic("sqrt() of a negative number");
  return vela_num(sqrt(d));
}

vela_value vela_builtin_floor(vela_value v) { return vela_num(floor(need_num(v, "floor()"))); }

vela_value vela_builtin_ceil(vela_value v) { return vela_num(ceil(need_num(v, "ceil()"))); }

vela_value vela_builtin_assert(vela_value v) {
  if (!vela_truthy(v)) vela_panic("assertion failed");
  return vela_nil();
}

vela_value vela_builtin_error(vela_value v) { vela_panic("%s", vela_to_cstr(v)); }

vela_value vela_builtin_range(vela_value v) {
  double d = need_num(v, "range()");
  long long n;
  vela_list *l;
  vela_value out;

  if (!(d >= -1e15 && d <= 1e15)) vela_panic("range() expects a whole number");
  n = (long long)d;
  if (d != (double)n) vela_panic("range() expects a whole number");

  l = (vela_list *)vela_alloc(sizeof(vela_list));
  l->len = n > 0 ? (size_t)n : 0;
  l->cap = l->len;
  if (l->len > 0) {
    l->items = (vela_value *)vela_alloc(l->len * sizeof(vela_value));
    for (size_t i = 0; i < l->len; i++) l->items[i] = vela_num((double)i);
  }
  out.type = VELA_LIST;
  out.as.list = l;
  return out;
}
