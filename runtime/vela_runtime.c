/*
 * The Vela runtime: the dynamic semantics behind every vela_value.
 *
 * Values are immutable, and memory is never freed: a Vela 0.1.0 program
 * allocates and keeps everything it makes (see the roadmap in the README).
 */

#include "vela_runtime.h"

#include <ctype.h>
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

static int values_equal(vela_value a, vela_value b);

static const char *type_name(vela_value v) {
  switch (v.type) {
    case VELA_NIL: return "nil";
    case VELA_NUM: return "num";
    case VELA_BOOL: return "bool";
    case VELA_STR: return "str";
    case VELA_LIST: return "list";
    case VELA_MAP: return "map";
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
    case VELA_MAP: return v.as.map->len > 0;
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
    case VELA_MAP:
      sb_putc(b, '{');
      for (size_t i = 0; i < v.as.map->len; i++) {
        if (i > 0) sb_puts(b, ", ");
        value_to_sb(b, v.as.map->keys[i]);
        sb_puts(b, ": ");
        value_to_sb(b, v.as.map->vals[i]);
      }
      sb_putc(b, '}');
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
    case VELA_MAP: {
      vela_map *ma = a.as.map;
      vela_map *mb = b.as.map;
      if (ma->len != mb->len) return 0;
      for (size_t i = 0; i < ma->len; i++) {
        int found = 0;
        for (size_t j = 0; j < mb->len; j++) {
          if (values_equal(ma->keys[i], mb->keys[j])) {
            if (!values_equal(ma->vals[i], mb->vals[j])) return 0;
            found = 1;
            break;
          }
        }
        if (!found) return 0;
      }
      return 1;
    }
  }
  return 0;
}

/* ------------------------------------------------------------------ */
/* maps                                                                */
/* ------------------------------------------------------------------ */

static long map_find(vela_map *m, vela_value key) {
  for (size_t i = 0; i < m->len; i++) {
    if (values_equal(m->keys[i], key)) return (long)i;
  }
  return -1;
}

vela_map *vela_as_map(vela_value v, const char *what) {
  if (v.type != VELA_MAP) {
    vela_panic("%s expects a map, got %s", what, type_name(v));
  }
  return v.as.map;
}

vela_value vela_map_new(void) {
  vela_map *m = (vela_map *)vela_alloc(sizeof(vela_map));
  vela_value v;
  v.type = VELA_MAP;
  v.as.map = m;
  return v;
}

vela_value vela_map_set(vela_value map, vela_value key, vela_value value) {
  vela_map *m = vela_as_map(map, "map write");
  long i = map_find(m, key);

  if (i >= 0) {
    m->vals[i] = value;
    return map;
  }
  if (m->len == m->cap) {
    size_t cap = m->cap ? m->cap * 2 : 8;
    m->keys = (vela_value *)vela_realloc(m->keys, cap * sizeof(vela_value));
    m->vals = (vela_value *)vela_realloc(m->vals, cap * sizeof(vela_value));
    m->cap = cap;
  }
  m->keys[m->len] = key;
  m->vals[m->len] = value;
  m->len++;
  return map;
}

vela_value vela_map_get(vela_value map, vela_value key) {
  vela_map *m = vela_as_map(map, "map read");
  long i = map_find(m, key);
  return i >= 0 ? m->vals[i] : vela_nil();
}

int vela_map_has(vela_value map, vela_value key) {
  vela_map *m = vela_as_map(map, "has()");
  return map_find(m, key) >= 0;
}

vela_value vela_map_remove(vela_value map, vela_value key) {
  vela_map *m = vela_as_map(map, "remove()");
  long i = map_find(m, key);
  if (i < 0) return map;
  for (size_t j = (size_t)i; j + 1 < m->len; j++) {
    m->keys[j] = m->keys[j + 1];
    m->vals[j] = m->vals[j + 1];
  }
  m->len--;
  return map;
}

static vela_value list_from_values(vela_value *items, size_t count) {
  vela_list *l = (vela_list *)vela_alloc(sizeof(vela_list));
  vela_value out;
  l->len = count;
  l->cap = count;
  if (count > 0) {
    l->items = (vela_value *)vela_alloc(count * sizeof(vela_value));
    memcpy(l->items, items, count * sizeof(vela_value));
  }
  out.type = VELA_LIST;
  out.as.list = l;
  return out;
}

vela_value vela_map_keys(vela_value map) {
  vela_map *m = vela_as_map(map, "keys()");
  return list_from_values(m->keys, m->len);
}

vela_value vela_map_values(vela_value map) {
  vela_map *m = vela_as_map(map, "values()");
  return list_from_values(m->vals, m->len);
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
  if (v.type == VELA_MAP) return vela_num((double)v.as.map->len);
  vela_panic("len() expects a string, a list or a map, got %s", type_name(v));
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

vela_value vela_index(vela_value container, vela_value index) {
  switch (container.type) {
    case VELA_LIST: {
      vela_list *l = container.as.list;
      return l->items[resolve_index(l, index, "[]")];
    }
    case VELA_MAP:
      return vela_map_get(container, index);
    case VELA_STR: {
      const char *s = container.as.str;
      size_t n = strlen(s);
      double d = need_num(index, "[]");
      long long i;

      if (!(d >= -1e15 && d <= 1e15)) vela_panic("[] expects a whole-number index");
      i = (long long)d;
      if (i < 0) i += (long long)n;
      if (i < 0 || i >= (long long)n) {
        vela_panic("[]: index %lld is out of range for a string of %zu byte(s)", i, n);
      }
      {
        char *one = (char *)vela_alloc(2);
        one[0] = s[i];
        one[1] = '\0';
        return vela_str(one);
      }
    }
    default:
      vela_panic("cannot index a %s", type_name(container));
  }
  return vela_nil();
}

vela_value vela_set_index(vela_value container, vela_value index, vela_value value) {
  switch (container.type) {
    case VELA_LIST: {
      vela_list *l = container.as.list;
      l->items[resolve_index(l, index, "[] =")] = value;
      return value;
    }
    case VELA_MAP:
      vela_map_set(container, index, value);
      return value;
    default:
      vela_panic("cannot assign into a %s", type_name(container));
  }
  return vela_nil();
}

vela_value vela_iter_list(vela_value v) {
  if (v.type == VELA_LIST) return v;
  if (v.type == VELA_MAP) return vela_map_keys(v);
  if (v.type == VELA_STR) {
    size_t n = strlen(v.as.str);
    vela_list *l = (vela_list *)vela_alloc(sizeof(vela_list));
    vela_value out;
    l->len = n;
    l->cap = n;
    if (n > 0) {
      l->items = (vela_value *)vela_alloc(n * sizeof(vela_value));
      for (size_t i = 0; i < n; i++) {
        char *one = (char *)vela_alloc(2);
        one[0] = v.as.str[i];
        one[1] = '\0';
        l->items[i] = vela_str(one);
      }
    }
    out.type = VELA_LIST;
    out.as.list = l;
    return out;
  }
  vela_panic("for loop expects a list, a map or a string, got %s", type_name(v));
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
    case VELA_MAP:
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


/* ---------------------------------------------------------------- */
/* strings and maps: string helpers                                  */
/* ---------------------------------------------------------------- */

static char *str_copy_range(const char *s, size_t n) {
  char *out = (char *)vela_alloc(n + 1);
  if (n > 0) memcpy(out, s, n);
  out[n] = '\0';
  return out;
}

static void list_push_value(vela_list *list, vela_value v) {
  if (list->len == list->cap) {
    size_t cap = list->cap ? list->cap * 2 : 4;
    list->items = (vela_value *)vela_realloc(list->items, cap * sizeof(vela_value));
    list->cap = cap;
  }
  list->items[list->len++] = v;
}

static vela_value new_list_value(void) {
  vela_list *l = (vela_list *)vela_alloc(sizeof(vela_list));
  vela_value v;
  v.type = VELA_LIST;
  v.as.list = l;
  return v;
}

vela_value vela_builtin_split(vela_value s, vela_value sep) {
  const char *text = need_str(s, "split()");
  const char *by = need_str(sep, "split()");
  size_t by_len = strlen(by);
  vela_value out = new_list_value();
  vela_list *l = out.as.list;

  if (by_len == 0) {
    size_t n = strlen(text);
    for (size_t i = 0; i < n; i++) {
      list_push_value(l, vela_str(str_copy_range(text + i, 1)));
    }
    return out;
  }

  {
    const char *cur = text;
    for (;;) {
      const char *hit = strstr(cur, by);
      size_t n = hit ? (size_t)(hit - cur) : strlen(cur);
      list_push_value(l, vela_str(str_copy_range(cur, n)));
      if (hit == NULL) break;
      cur = hit + by_len;
    }
  }
  return out;
}

vela_value vela_builtin_join(vela_value list, vela_value sep) {
  vela_list *l = vela_as_list(list, "join()");
  const char *by = need_str(sep, "join()");
  size_t by_len = strlen(by);
  size_t total = 0;
  char *out;
  size_t at = 0;

  for (size_t i = 0; i < l->len; i++) {
    total += strlen(vela_to_cstr(l->items[i]));
    if (i + 1 < l->len) total += by_len;
  }

  out = (char *)vela_alloc(total + 1);
  for (size_t i = 0; i < l->len; i++) {
    const char *piece = vela_to_cstr(l->items[i]);
    size_t n = strlen(piece);
    memcpy(out + at, piece, n);
    at += n;
    if (i + 1 < l->len) {
      memcpy(out + at, by, by_len);
      at += by_len;
    }
  }
  out[at] = '\0';
  return vela_str(out);
}

vela_value vela_builtin_upper(vela_value s) {
  const char *text = need_str(s, "upper()");
  size_t n = strlen(text);
  char *out = (char *)vela_alloc(n + 1);
  for (size_t i = 0; i < n; i++) out[i] = (char)toupper((unsigned char)text[i]);
  out[n] = '\0';
  return vela_str(out);
}

vela_value vela_builtin_lower(vela_value s) {
  const char *text = need_str(s, "lower()");
  size_t n = strlen(text);
  char *out = (char *)vela_alloc(n + 1);
  for (size_t i = 0; i < n; i++) out[i] = (char)tolower((unsigned char)text[i]);
  out[n] = '\0';
  return vela_str(out);
}

vela_value vela_builtin_trim(vela_value s) {
  const char *text = need_str(s, "trim()");
  size_t n = strlen(text);
  size_t start = 0;
  size_t end = n;

  while (start < end && isspace((unsigned char)text[start])) start++;
  while (end > start && isspace((unsigned char)text[end - 1])) end--;
  return vela_str(str_copy_range(text + start, end - start));
}

vela_value vela_builtin_contains(vela_value haystack, vela_value needle) {
  if (haystack.type == VELA_STR) {
    return vela_bool(strstr(haystack.as.str, need_str(needle, "contains()")) != NULL);
  }
  if (haystack.type == VELA_LIST) {
    vela_list *l = haystack.as.list;
    for (size_t i = 0; i < l->len; i++) {
      if (values_equal(l->items[i], needle)) return vela_bool(1);
    }
    return vela_bool(0);
  }
  vela_panic("contains() expects a string or a list, got %s", type_name(haystack));
}

vela_value vela_builtin_replace(vela_value s, vela_value from, vela_value to) {
  const char *text = need_str(s, "replace()");
  const char *needle = need_str(from, "replace()");
  const char *with = need_str(to, "replace()");
  size_t needle_len = strlen(needle);
  size_t with_len = strlen(with);
  size_t cap = strlen(text) + 1;
  size_t at = 0;
  char *out;
  const char *cur = text;

  if (needle_len == 0) return vela_str(str_copy_range(text, strlen(text)));

  for (;;) {
    const char *hit = strstr(cur, needle);
    if (hit == NULL) break;
    cap += with_len;
    cur = hit + needle_len;
  }

  out = (char *)vela_alloc(cap);
  cur = text;
  for (;;) {
    const char *hit = strstr(cur, needle);
    size_t piece = hit ? (size_t)(hit - cur) : strlen(cur);
    memcpy(out + at, cur, piece);
    at += piece;
    if (hit == NULL) break;
    memcpy(out + at, with, with_len);
    at += with_len;
    cur = hit + needle_len;
  }
  out[at] = '\0';
  return vela_str(out);
}

vela_value vela_builtin_starts_with(vela_value s, vela_value prefix) {
  const char *text = need_str(s, "startsWith()");
  const char *pre = need_str(prefix, "startsWith()");
  size_t n = strlen(pre);
  return vela_bool(strncmp(text, pre, n) == 0);
}

vela_value vela_builtin_ends_with(vela_value s, vela_value suffix) {
  const char *text = need_str(s, "endsWith()");
  const char *suf = need_str(suffix, "endsWith()");
  size_t n = strlen(text);
  size_t m = strlen(suf);
  if (m > n) return vela_bool(0);
  return vela_bool(strcmp(text + (n - m), suf) == 0);
}

vela_value vela_builtin_index_of(vela_value haystack, vela_value needle) {
  if (haystack.type == VELA_STR) {
    const char *hit = strstr(haystack.as.str, need_str(needle, "indexOf()"));
    return vela_num(hit == NULL ? -1 : (double)(hit - haystack.as.str));
  }
  if (haystack.type == VELA_LIST) {
    vela_list *l = haystack.as.list;
    for (size_t i = 0; i < l->len; i++) {
      if (values_equal(l->items[i], needle)) return vela_num((double)i);
    }
    return vela_num(-1);
  }
  vela_panic("indexOf() expects a string or a list, got %s", type_name(haystack));
}

vela_value vela_builtin_keys(vela_value map) { return vela_map_keys(map); }

vela_value vela_builtin_values(vela_value map) { return vela_map_values(map); }

vela_value vela_builtin_has(vela_value map, vela_value key) {
  return vela_bool(vela_map_has(map, key));
}

vela_value vela_builtin_remove(vela_value map, vela_value key) {
  return vela_map_remove(map, key);
}
