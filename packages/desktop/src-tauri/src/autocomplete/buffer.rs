const BOUNDARIES: &[char] = &[
    ' ', '\t', '\n', '\r', '.', ',', '!', '?', ';', ':', '(', ')',
    '[', ']', '{', '}', '"', '\u{201c}', '\u{201d}',
];

pub struct WordBuffer {
    chars: Vec<char>,
}

impl Default for WordBuffer {
    fn default() -> Self { Self::new() }
}

impl WordBuffer {
    pub fn new() -> Self { Self { chars: Vec::new() } }

    /// Returns true if ch was a word boundary (buffer cleared).
    pub fn push(&mut self, ch: char) -> bool {
        if BOUNDARIES.contains(&ch) {
            self.chars.clear();
            true
        } else if ch == '\x08' {
            // backspace
            self.chars.pop();
            false
        } else if ch.is_alphabetic() || ch == '\'' || ch == '-' {
            self.chars.push(ch);
            false
        } else {
            false
        }
    }

    pub fn current(&self) -> String {
        self.chars.iter().collect()
    }

    pub fn clear(&mut self) {
        self.chars.clear();
    }

    /// Characters to send when user taps `full_word` — the suffix after the partial.
    pub fn completion_suffix(&self, full_word: &str) -> String {
        let partial = self.current();
        if full_word.to_lowercase().starts_with(&partial.to_lowercase()) && partial.chars().count() <= full_word.chars().count() {
            full_word.chars().skip(partial.chars().count()).collect()
        } else {
            full_word.to_string()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_accumulates_chars() {
        let mut b = WordBuffer::new();
        b.push('h'); b.push('e'); b.push('l');
        assert_eq!(b.current(), "hel");
    }

    #[test]
    fn test_space_is_boundary() {
        let mut b = WordBuffer::new();
        b.push('h'); b.push('i');
        let was_boundary = b.push(' ');
        assert!(was_boundary);
        assert_eq!(b.current(), "");
    }

    #[test]
    fn test_punctuation_is_boundary() {
        let mut b = WordBuffer::new();
        b.push('h'); b.push('i');
        let was_boundary = b.push('.');
        assert!(was_boundary);
        assert_eq!(b.current(), "");
    }

    #[test]
    fn test_backspace_removes_last() {
        let mut b = WordBuffer::new();
        b.push('h'); b.push('e'); b.push('l');
        b.push('\x08'); // backspace
        assert_eq!(b.current(), "he");
    }

    #[test]
    fn test_backspace_not_boundary() {
        let mut b = WordBuffer::new();
        b.push('h');
        let was_boundary = b.push('\x08');
        assert!(!was_boundary);
    }

    #[test]
    fn test_completion_suffix() {
        let mut b = WordBuffer::new();
        b.push('h'); b.push('e'); b.push('l');
        assert_eq!(b.completion_suffix("hello"), "lo");
    }

    #[test]
    fn test_completion_suffix_full_word_if_no_match() {
        let mut b = WordBuffer::new();
        b.push('x'); b.push('y'); b.push('z');
        assert_eq!(b.completion_suffix("hello"), "hello");
    }

    #[test]
    fn test_completion_suffix_unicode() {
        let mut b = WordBuffer::new();
        "café".chars().for_each(|c| { b.push(c); });
        assert_eq!(b.completion_suffix("cafés"), "s");
    }
}
