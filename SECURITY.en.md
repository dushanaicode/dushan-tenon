# Security policy

[中文](SECURITY.md)

## Supported versions

Only the latest pre-release and the `main` branch receive fixes. If you use an older version, upgrade to the latest one and confirm the problem is still there before reporting it.

## Reporting a vulnerability

Please do not open a public issue. Use GitHub private vulnerability reporting: open <https://github.com/dushanaicode/dushan-tenon/security/advisories/new>, or click "Report a vulnerability" on the repository's Security page. Only you and the maintainer can see the report.

Please include:

- the affected version or commit;
- what the problem is and what it allows;
- steps to reproduce or a proof of concept;
- your environment, such as the Windows version.

Do not attach real credentials, personal data, or your own database or log files.

## What happens next

- The report will be acknowledged as soon as possible, and the discussion continues in the report.
- Once a vulnerability is confirmed and fixed, the release notes will say so, and a security advisory will be published when needed.
- If you wish, you will be credited in the notes.

## Scope

- All code in this repository is in scope: the host, the modules, the frontend and the scripts.
- Vulnerabilities in a third-party dependency itself should go to its maintainers. If one affects this project, please tell us as well.
- Projects derived from this repository should be reported to their own maintainers.
