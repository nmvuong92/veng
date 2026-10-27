class Veng < Formula
  desc "Luyện thì tiếng Anh trong terminal — dịch Việt → Anh, AI chấm"
  homepage "https://github.com/nmvuong92/veng"
  url "https://github.com/nmvuong92/veng/releases/download/v0.1.0/veng-0.1.0.tgz"
  sha256 "f3f910dc8e0a52021b4aabd81b13ce05fe1e9f808e3f29d805bff82542406638"
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
