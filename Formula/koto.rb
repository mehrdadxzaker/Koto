class Koto < Formula
  desc "Coordinate commercial and open-source coding agents"
  homepage "https://github.com/mehrdadxzaker/Koto"
  url "https://registry.npmjs.org/@mehrdadz/koto/-/koto-3.0.0-alpha.1.tgz"
  version "3.0.0-alpha.1"
  sha256 "52673651a84c3daa9989e667a4e583403bd693f6e5d7b8c3772c5136d5c4b18c"
  license "Apache-2.0"

  depends_on "node@24"
  # The wrapper selects Node; preserve every byte of the pinned npm payload.
  skip_clean "libexec"

  def install
    libexec.install Dir["*"]
    # Supply metadata without letting Homebrew move it out of the frozen payload.
    cp [libexec/"LICENSE", libexec/"README.md"], prefix
    (bin/"koto").write_env_script libexec/"bin/koto.js",
                                PATH: "#{Formula["node@24"].opt_bin}:$PATH"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/koto --version")
    assert_match "Usage:", shell_output("#{bin}/koto --help")
  end
end
