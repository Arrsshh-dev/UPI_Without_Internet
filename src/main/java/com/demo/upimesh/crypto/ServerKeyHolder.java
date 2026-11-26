package com.demo.upimesh.crypto;

import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;

/**
 * Holds the server's RSA keypair.
 *
 * Persists and loads the keypair from files configured by `upi.server.key-dir`
 * (default `./keys`):
 *   - server-private.pk8 (PKCS#8, base64)
 *   - server-public.x509 (X.509 SPKI, base64)
 *
 * If files are missing, generates a 2048-bit RSA pair, writes them, and logs
 * only the public key fingerprint. Never logs the private key.
 */
@Component
public class ServerKeyHolder {

    private static final Logger log = LoggerFactory.getLogger(ServerKeyHolder.class);

    private static final String PRIVATE_KEY_FILE = "server-private.pk8";
    private static final String PUBLIC_KEY_FILE = "server-public.x509";

    @Value("${upi.server.key-dir:./keys}")
    private String keyDir;

    private KeyPair keyPair;

    public ServerKeyHolder() {}

    /** Constructor for direct instantiation in tests */
    public ServerKeyHolder(String keyDir) {
        this.keyDir = keyDir;
    }

    @PostConstruct
    public void init() throws Exception {
        loadOrGenerateKey();
    }

    public synchronized void loadOrGenerateKey() throws Exception {
        Path dirPath = Paths.get(keyDir);
        Path privatePath = dirPath.resolve(PRIVATE_KEY_FILE);
        Path publicPath = dirPath.resolve(PUBLIC_KEY_FILE);

        if (Files.exists(privatePath) && Files.exists(publicPath)) {
            try {
                this.keyPair = loadKeyPair(privatePath, publicPath);
                log.info("Loaded persisted Server RSA keypair from {}. Public key fingerprint: {}",
                        dirPath.toAbsolutePath(),
                        getPublicKeyBase64().substring(0, Math.min(32, getPublicKeyBase64().length())) + "...");
                return;
            } catch (Exception e) {
                log.warn("Failed to load existing keys from {}. Regenerating. Reason: {}",
                        dirPath.toAbsolutePath(), e.getMessage());
            }
        }

        Files.createDirectories(dirPath);
        KeyPairGenerator gen = KeyPairGenerator.getInstance("RSA");
        gen.initialize(2048);
        this.keyPair = gen.generateKeyPair();

        String privateKeyB64 = Base64.getEncoder().encodeToString(this.keyPair.getPrivate().getEncoded());
        String publicKeyB64 = Base64.getEncoder().encodeToString(this.keyPair.getPublic().getEncoded());

        Files.writeString(privatePath, privateKeyB64, StandardCharsets.UTF_8);
        Files.writeString(publicPath, publicKeyB64, StandardCharsets.UTF_8);

        log.info("Server RSA keypair generated (2048-bit) and saved to {}. Public key fingerprint: {}",
                dirPath.toAbsolutePath(),
                publicKeyB64.substring(0, Math.min(32, publicKeyB64.length())) + "...");
    }

    private KeyPair loadKeyPair(Path privatePath, Path publicPath) throws Exception {
        String privateKeyB64 = Files.readString(privatePath, StandardCharsets.UTF_8).trim();
        String publicKeyB64 = Files.readString(publicPath, StandardCharsets.UTF_8).trim();

        byte[] privateKeyBytes = Base64.getDecoder().decode(privateKeyB64);
        byte[] publicKeyBytes = Base64.getDecoder().decode(publicKeyB64);

        KeyFactory keyFactory = KeyFactory.getInstance("RSA");
        PrivateKey privateKey = keyFactory.generatePrivate(new PKCS8EncodedKeySpec(privateKeyBytes));
        PublicKey publicKey = keyFactory.generatePublic(new X509EncodedKeySpec(publicKeyBytes));

        return new KeyPair(publicKey, privateKey);
    }

    public PublicKey getPublicKey() {
        return keyPair.getPublic();
    }

    public PrivateKey getPrivateKey() {
        return keyPair.getPrivate();
    }

    public String getPublicKeyBase64() {
        return Base64.getEncoder().encodeToString(keyPair.getPublic().getEncoded());
    }
}
