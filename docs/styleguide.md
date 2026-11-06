# Documentation styleguide

Tortoise documentation describes the framework as implemented. Explain its purpose and the responsibilities of the component under discussion, then develop the technical explanation in connected paragraphs. The framework's purpose comes from supporting custom applications for specialized processes at the edge. Hypothetical applications do not define that purpose or establish how every application behaves.

## Technical explanations

Describe a mechanism through its actual contract and implementation. Name the component responsible for an operation and state the conditions under which its guarantees apply. Distinguish configured behavior from defaults by naming the configuration that enables it. Explain dependencies where the reader needs them to understand the behavior.

Framework guides must be understandable without a demonstration application. Do not explain the framework through a hypothetical business workflow. Do not add a catalogue of demo applications. Small API declarations may document an interface when their fields are explained directly.

Use plain technical language. Avoid promotional claims and statements about how important a subject is. Do not use rhetorical triads, paired slogans, binary contrasts, numbered pairs or repeated sentence rhythms. Let the subject determine the paragraph structure. A shorter sentence is useful when it makes the relationship clearer; a succession of fragments does not explain a mechanism.

Use headings when a reader needs a section to navigate to. A table can specify an interface or compare actual configuration values. Lists are appropriate for information that has a technical ordering or an explicit enumeration in the software. Do not reorganize prose into decorative lists or impose a fixed number of points. Link to the explanation at the place where it helps the reader.

## Document responsibilities

The root README explains why the framework exists and provides a working entry point. Architecture explains the application model and its boundaries. Each guide owns a technical subject and develops it without repeating the general introduction. The concept reference gives a term its precise definition and identifies its implementation.

A workspace README describes the package's responsibility and gives the entrypoints needed to use or change it. Keep general framework explanations in their guide. Skills give valid instructions for a task and link to the underlying explanation. Preserve their discovery metadata.

Tutorials explain how to build the application. Introduce its requirements in the application's own terms and explain the implementation around each coding-agent prompt. Avoid repeated disclaimers about the application being a demonstration. State the required starting state and provide actions that demonstrate the behavior. Label excerpts taken from the finished reference application; later code must not appear to exist at an earlier checkpoint.

## Accuracy and verification

Check claims against current source. Preserve the distinction between a committed local change and acceptance by an external system. State trust boundaries and failure behavior where they affect the operation. Explain a default as a default and identify what can configure it.

Commands must name the directory in which they run. Configuration fragments must identify their destination file. Links and headings must resolve after a page moves. Generated reference files remain outside version control.

Describe what a check actually establishes. Passing tests on a completed application does not establish that earlier tutorial checkpoints work. Keep dated observations and unresolved gaps accurate. Live execution requires explicitly configured accounts or equipment; fixture results do not establish live behavior.
