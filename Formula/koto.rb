class Koto < Formula
  desc "Coordinate commercial and open-source coding agents"
  homepage "https://github.com/mehrdadxzaker/Koto"
  url "https://registry.npmjs.org/@mehrdadz/koto/-/koto-3.0.0-alpha.2.tgz"
  version "3.0.0-alpha.2"
  sha256 "db2dc6769f0e4a27ed3a4baaee42a03201eb341b10aeccf067d2bac4bdd76afc"
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
