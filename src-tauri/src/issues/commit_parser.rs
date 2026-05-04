use regex::Regex;
use once_cell::sync::Lazy;

static RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(?:close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\s+#(\d+)").unwrap()
});

pub fn parse_issue_numbers(message: &str) -> Vec<i64> {
    RE.captures_iter(message)
        .filter_map(|cap| cap.get(1).map(|m| m.as_str().parse::<i64>().ok()))
        .flatten()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_issue_numbers() {
        let msg = "Fixes #1 and closes #42. Also resolved #123";
        let numbers = parse_issue_numbers(msg);
        assert_eq!(numbers, vec![1, 42, 123]);
    }

    #[test]
    fn test_case_insensitive() {
        let msg = "FIXES #1 and CLOSED #2";
        let numbers = parse_issue_numbers(msg);
        assert_eq!(numbers, vec![1, 2]);
    }
}
