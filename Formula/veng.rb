class Veng < Formula
  desc "Luyện thì tiếng Anh trong terminal — dịch Việt → Anh, AI chấm"
  homepage "https://github.com/nmvuong92/veng"
  url "https://github.com/nmvuong92/veng/releases/download/v0.8.1/veng-0.8.1.tgz"
  sha256 "2ede86b9c1e5156ddc1944563f2a41169a680b53670cca5236a0938b3ce95689"
  license "MIT"

  depends_on "node"

  def install
    libexec.install "veng.mjs"
    (bin/"veng").write <<~SH
      #!/bin/bash
      exec "#{Formula["node"].opt_bin}/node" "#{libexec}/veng.mjs" "$@"
    SH
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/veng --version")
  end
end
