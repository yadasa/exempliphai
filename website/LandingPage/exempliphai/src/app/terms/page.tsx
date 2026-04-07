export const dynamic = "force-static";

export default function TermsOfServicePage() {
  return (
    <main className="container max-w-3xl py-12">
      <h1 className="text-3xl font-bold">Terms of Service</h1>
      <p className="mt-3 text-muted-foreground">Last updated: April 6, 2026</p>

      <section className="prose prose-neutral dark:prose-invert mt-8 max-w-none">
        <p>
          These Terms of Service ("Terms") govern your use of <b>exempliphai</b>'s website and browser
          extension (collectively, the "Services"). By using the Services, you agree to these Terms.
          If you do not agree, do not use the Services.
        </p>

        <h2>Eligibility</h2>
        <p>
          You must be legally able to enter into these Terms. You are responsible for ensuring your
          use of the Services complies with applicable laws and the terms of any third-party sites you
          access.
        </p>

        <h2>Your Account</h2>
        <ul>
          <li>You are responsible for activity under your account.</li>
          <li>Do not misuse the Services or attempt to bypass security or usage limits.</li>
        </ul>

        <h2>AI Features</h2>
        <p>
          The Services may generate content using AI. AI outputs may be inaccurate or incomplete.
          You are responsible for reviewing outputs before using them in job applications.
        </p>

        <h2>Job Application Automation</h2>
        <p>
          The extension assists with filling forms and may attempt to click "Next" or "Submit" when you
          enable auto-submit. You acknowledge that automation may not always behave as expected and you
          should supervise submissions.
        </p>

        <h2>Payments and Tokens</h2>
        <p>
          Some features require payment (e.g., token packs or subscription plans). Purchases may be
          non-refundable except where required by law. Token balances may be deducted when you use
          paid features.
        </p>

        <h2>Acceptable Use</h2>
        <ul>
          <li>Do not use the Services for unlawful, harmful, or abusive purposes.</li>
          <li>Do not attempt to reverse engineer, scrape, or exfiltrate proprietary data.</li>
          <li>Do not interfere with or disrupt the Services.</li>
        </ul>

        <h2>Intellectual Property</h2>
        <p>
          We and our licensors own the Services, including software, branding, and content, except for
          content you provide.
        </p>

        <h2>Disclaimer</h2>
        <p>
          THE SERVICES ARE PROVIDED "AS IS" WITHOUT WARRANTIES OF ANY KIND. WE DO NOT GUARANTEE THAT
          YOU WILL RECEIVE JOB OFFERS OR THAT APPLICATIONS WILL BE SUBMITTED SUCCESSFULLY.
        </p>

        <h2>Limitation of Liability</h2>
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, EXAMPLIPHAI WILL NOT BE LIABLE FOR INDIRECT,
          INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF DATA, PROFITS, OR
          REPUTATION.
        </p>

        <h2>Termination</h2>
        <p>
          We may suspend or terminate access to the Services at any time if we reasonably believe you
          violated these Terms or if necessary to protect the Services.
        </p>

        <h2>Changes</h2>
        <p>
          We may update these Terms from time to time. Continued use after changes means you accept
          the updated Terms.
        </p>

        <h2>Contact</h2>
        <p>
          Questions: <a href="mailto:support@exempliph.ai">support@exempliph.ai</a>
        </p>
      </section>
    </main>
  );
}
