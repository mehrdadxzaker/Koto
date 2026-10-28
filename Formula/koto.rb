class Koto < Formula
  desc "Coordinate commercial and open-source coding agents"
  homepage "https://github.com/mehrdadxzaker/Koto"
  url "https://registry.npmjs.org/@mehrdadz/koto/-/koto-3.0.0-alpha.0.tgz"
  version "3.0.0-alpha.0"
  sha256 "f0ca6be082af7a95b75a753557db2fc9a7468fa4ac49f75eee236ce9f8d96dfe"
  license "Apache-2.0"

  depends_on "node@24"

  def install
    libexec.install Dir["*"]
    (bin/"koto").write_env_script libexec/"bin/koto.js",
                                PATH: "#{Formula["node@24"].opt_bin}:$PATH"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/koto --version")
    assert_match "Usage:", shell_output("#{bin}/koto --help")
  end
end
