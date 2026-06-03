use std::sync::OnceLock;

static WORDS: OnceLock<Vec<String>> = OnceLock::new();

fn get_words() -> &'static Vec<String> {
    WORDS.get_or_init(|| {
        let raw = std::fs::read_to_string("/usr/share/dict/words").unwrap_or_default();
        let set: std::collections::BTreeSet<String> = raw
            .lines()
            .filter(|w| w.len() > 2 && w.chars().all(|c| c.is_ascii_alphabetic()))
            .map(|w| w.to_lowercase())
            .collect();
        set.into_iter().collect()
    })
}

pub fn get_completions(partial: &str, count: usize) -> Vec<String> {
    if partial.len() < 2 {
        return vec![];
    }
    let partial_lower = partial.to_lowercase();
    let words = get_words();
    let start = words.partition_point(|w| w.as_str() < partial_lower.as_str());
    let capitalize = partial.chars().next().map(|c| c.is_uppercase()).unwrap_or(false);
    words[start..]
        .iter()
        .take_while(|w| w.starts_with(&partial_lower))
        .take(count)
        .map(|w| {
            if capitalize {
                let mut chars = w.chars();
                match chars.next() {
                    None => String::new(),
                    Some(c) => c.to_uppercase().to_string() + chars.as_str(),
                }
            } else {
                w.clone()
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "macos")]
    #[test]
    fn test_completions_for_hel() {
        let results = get_completions("hel", 5);
        assert!(!results.is_empty(), "expected completions for 'hel'");
        assert!(results.iter().all(|w| w.to_lowercase().starts_with("hel")));
    }

    #[test]
    fn test_completions_respects_count() {
        let results = get_completions("the", 3);
        assert!(results.len() <= 3);
    }

    #[test]
    fn test_short_partial_returns_empty() {
        let results = get_completions("a", 5);
        assert!(results.is_empty());
    }

    #[test]
    fn test_unknown_partial_returns_empty() {
        let results = get_completions("zzzzzzzzz", 5);
        assert!(results.is_empty());
    }
}
